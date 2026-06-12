import { useCallback, useEffect, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Progress,
  Space,
  Typography,
  message,
} from "antd";
import {
  CloseCircleOutlined,
  RocketOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";

const { Text } = Typography;

export default function TemuRobots() {
  return (
    <div className="dashboard-shell temu-robots-shell">
      <PageHeader
        compact
        eyebrow="数据工作台"
        title="TEMU 机器人 · 批量采集"
        subtitle="机器人按店铺顺序自动登录采集并上报云端，采集完成后自动回灌 ERP。"
      />

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
  fundSummary: "账户概览/资金汇总",
  fundEnum: "资金限制枚举",
  settlementOrders: "结算订单明细",
  settlementViolation: "违规信息",
  eprGoodsWait: "EPR商品级待扣",
  eprGoodsDeducted: "EPR商品级已扣",
  eprPlatform: "EPR平台/主权级",
  eprPackage: "EPR包裹级",
  fundFrozen: "资金限制明细",
  accountOverview: "账户概览",
  fulfillmentBillOverview: "履约费用总览",
  fulfillmentBillDetail: "履约费用明细",
  eprExport: "EPR导出明细",
  settleExport: "结算数据导出",
  financeExport: "账务明细导出",
  fulfillmentPaid: "履约已缴费",
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
  const [mallLoading, setMallLoading] = useState(false);
  const [selectedMallIds, setSelectedMallIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ current: number; total: number; currentMall: string } | null>(null);
  // 结算时间范围：默认当月 1 号→今天（与 worker 兜底一致），透传给 batch-collect 的 startDate/endDate
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf("month"), dayjs()]);

  const loadMalls = useCallback(async (manual = false) => {
    const api = (window as any).electronAPI;
    setMallLoading(true);
    try {
      try {
        const resp = await api?.erp?.reports?.mallDict?.();
        if (!resp?.ok || !Array.isArray(resp.data?.malls)) {
          if (manual) message.warning("店铺列表加载失败：主控端无响应，请稍后再试");
          return;
        }
        const malls: MallItem[] = resp.data.malls
          .filter((m: any) => m.status !== "test" && m.mall_id && m.store_code)
          .sort((a: any, b: any) => (a.store_code || "").localeCompare(b.store_code || ""));
        setMallList(malls);
        setSelectedMallIds(new Set(malls.map((m: MallItem) => m.mall_id)));
        if (manual) message.success(`已加载 ${malls.length} 个店铺`);

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
      } catch {
        if (manual) message.warning("店铺列表加载失败：主控端无响应，请稍后再试");
      }
    } finally {
      setMallLoading(false);
    }
  }, []);

  useEffect(() => { loadMalls(); }, [loadMalls]);

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
        startDate: dateRange[0].format("YYYY-MM-DD"),
        endDate: dateRange[1].format("YYYY-MM-DD"),
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
  }, [selectedTasks, mallList, selectedMallIds, dateRange]);

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
    <section className="app-panel">
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
        <Space size={8}>
          <Button
            icon={<SyncOutlined />}
            loading={mallLoading}
            disabled={collecting}
            onClick={() => loadMalls(true)}
          >
            刷新
          </Button>
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
        </Space>
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

      {selectedTasks.includes("settlement") && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <Text strong style={{ fontSize: 13 }}>结算时间范围</Text>
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(vals) => { if (vals?.[0] && vals?.[1]) setDateRange([vals[0], vals[1]]); }}
            disabled={collecting}
            allowClear={false}
            size="small"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>账务流水 / 已结算 / EPR 按此范围采集（账户余额等汇总不受影响）</Text>
        </div>
      )}

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
