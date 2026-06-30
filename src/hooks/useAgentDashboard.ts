import useSWR, { type SWRConfiguration } from "swr";
import { useCallback, useRef } from "react";

function getBaseUrl(): string {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return "";
  return "https://erp.temu.chat";
}

async function agentFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const base = getBaseUrl();
  const url = `${base}/api/agent/${path}`;
  const resp = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Agent API ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

const SWR_OPTS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateIfStale: false,
  shouldRetryOnError: false,
  dedupingInterval: 10_000,
};

// ─── Agent 状态 ───
export interface AgentStatus {
  initialized: boolean;
  running: boolean;
  pending_approvals: number;
}

export function useAgentStatus() {
  const { data, isLoading, mutate } = useSWR<AgentStatus>(
    "agent:status",
    () => agentFetch("status"),
    { ...SWR_OPTS, refreshInterval: 5_000 },
  );
  return {
    status: data ?? { initialized: false, running: false, pending_approvals: 0 },
    loading: isLoading,
    reload: () => mutate(),
  };
}

// ─── 审批列表 ───
export interface ApprovalItem {
  id: string;
  run_id: string;
  tool_name: string;
  tool_input: string;
  status: string;
  created_at: string;
  resolved_at?: string;
  reject_reason?: string;
}

export function usePendingApprovals() {
  const { data, isLoading, mutate } = useSWR<{ items: ApprovalItem[] }>(
    "agent:approvals:pending",
    () => agentFetch("approvals/pending"),
    { ...SWR_OPTS, refreshInterval: 5_000 },
  );
  return {
    items: data?.items ?? [],
    loading: isLoading,
    reload: () => mutate(),
  };
}

export function useRecentApprovals() {
  const { data, isLoading, mutate } = useSWR<{ items: ApprovalItem[] }>(
    "agent:approvals:recent",
    () => agentFetch("approvals/recent"),
    SWR_OPTS,
  );
  return {
    items: data?.items ?? [],
    loading: isLoading,
    reload: () => mutate(),
  };
}

// ─── 记忆列表 ───
export interface MemoryItem {
  id: string;
  title: string;
  content: string;
  tags: string;
  confidence: number;
  created_at: string;
}

export function useAgentMemory() {
  const { data, isLoading, mutate } = useSWR<{ items: MemoryItem[] }>(
    "agent:memory:list",
    () => agentFetch("memory/list"),
    SWR_OPTS,
  );
  return {
    items: data?.items ?? [],
    loading: isLoading,
    reload: () => mutate(),
  };
}

// ─── 全局快照 ───
export interface SnapshotSection {
  label: string;
  [key: string]: any;
}

export interface GlobalSnapshot {
  generated_at: string;
  date: string;
  sections: Record<string, SnapshotSection>;
}

export function useGlobalSnapshot() {
  const { data, isLoading, mutate } = useSWR<GlobalSnapshot>(
    "agent:snapshot",
    () => agentFetch("snapshot"),
    SWR_OPTS,
  );
  return {
    snapshot: data ?? null,
    loading: isLoading,
    reload: () => mutate(),
  };
}

// ─── Agent 操作 ───
export function useAgentActions() {
  const busyRef = useRef(false);

  const startPatrol = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      return await agentFetch("start-patrol", { method: "POST" });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    return agentFetch("send-message", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  }, []);

  const abort = useCallback(async () => {
    return agentFetch("abort", { method: "POST" });
  }, []);

  const approveItem = useCallback(async (id: string) => {
    return agentFetch("approvals/approve", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  }, []);

  const rejectItem = useCallback(async (id: string, reason = "") => {
    return agentFetch("approvals/reject", {
      method: "POST",
      body: JSON.stringify({ id, reason }),
    });
  }, []);

  const recallMemory = useCallback(async (query: string, limit = 5) => {
    return agentFetch<{ items: MemoryItem[] }>("memory/recall", {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    });
  }, []);

  const resolveIssue = useCallback(async (id: string, status: string, resolution = "") => {
    return agentFetch(`issues/${id}`, {
      method: "POST",
      body: JSON.stringify({ status, resolution }),
    });
  }, []);

  const cancelFollowup = useCallback(async (id: string) => {
    return agentFetch("followups/cancel", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  }, []);

  return { startPatrol, sendMessage, abort, approveItem, rejectItem, recallMemory, resolveIssue, cancelFollowup };
}

// ─── Issues (问题追踪) ───
export interface AgentIssue {
  id: string;
  run_id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  context: string;
  status: string;
  resolved_by?: string;
  resolution?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
}

export interface IssueStat {
  category: string;
  active_count: number;
  critical_count: number;
  total_count: number;
}

export interface IssueTrend {
  day: string;
  category: string;
  count: number;
}

export function useAgentIssues(filters?: { status?: string; category?: string }) {
  const qs = new URLSearchParams();
  if (filters?.status) qs.set("status", filters.status);
  if (filters?.category) qs.set("category", filters.category);
  const key = `agent:issues:${qs.toString()}`;
  const { data, isLoading, mutate } = useSWR<{ items: AgentIssue[] }>(
    key,
    () => agentFetch(`issues?${qs.toString()}`),
    { ...SWR_OPTS, refreshInterval: 10_000 },
  );
  return { items: data?.items ?? [], loading: isLoading, reload: () => mutate() };
}

export function useAgentIssueStats() {
  const { data, isLoading, mutate } = useSWR<{ stats: IssueStat[]; trend: IssueTrend[] }>(
    "agent:issues:stats",
    () => agentFetch("issues/stats"),
    { ...SWR_OPTS, refreshInterval: 30_000 },
  );
  return {
    stats: data?.stats ?? [],
    trend: data?.trend ?? [],
    loading: isLoading,
    reload: () => mutate(),
  };
}

// ─── Runs (运行历史) ───
export interface AgentRun {
  id: string;
  trigger_type: string;
  status: string;
  turns: number;
  reply: string;
  issue_count: number;
  started_at: string;
  finished_at?: string;
  error?: string;
}

export interface RunEvent {
  id: number;
  run_id: string;
  turn?: number;
  event_type: string;
  tool_name?: string;
  content: string;
  created_at: string;
}

export function useAgentRuns() {
  const { data, isLoading, mutate } = useSWR<{ items: AgentRun[] }>(
    "agent:runs",
    () => agentFetch("runs"),
    { ...SWR_OPTS, refreshInterval: 10_000 },
  );
  return { items: data?.items ?? [], loading: isLoading, reload: () => mutate() };
}

export function useAgentRunDetail(runId: string | null) {
  const { data, isLoading } = useSWR(
    runId ? `agent:runs:${runId}` : null,
    () => runId ? agentFetch<{ run: AgentRun; events: RunEvent[] }>(`runs/${runId}`) : null,
    SWR_OPTS,
  );
  return { run: data?.run ?? null, events: data?.events ?? [], loading: isLoading };
}

// ─── Followups (定时任务) ───
export interface AgentFollowup {
  id: number;
  description: string;
  context: string;
  fire_at: string;
  created_at: string;
}

export function useAgentFollowups() {
  const { data, isLoading, mutate } = useSWR<{ items: AgentFollowup[] }>(
    "agent:followups",
    () => agentFetch("followups"),
    { ...SWR_OPTS, refreshInterval: 30_000 },
  );
  return { items: data?.items ?? [], loading: isLoading, reload: () => mutate() };
}
