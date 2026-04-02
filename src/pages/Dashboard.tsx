import {
  Button,
  Collapse,
  Progress,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import {
  useCollection,
  COLLECT_TASKS,
  TASK_CATEGORIES,
  type TaskStatus,
} from "../contexts/CollectionContext";

const { Text } = Typography;

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
};

const getTaskIcon = (status: TaskStatus) => {
  switch (status) {
    case "running":
      return <LoadingOutlined style={{ color: "var(--color-brand)" }} spin />;
    case "success":
      return <CheckCircleOutlined style={{ color: "var(--color-success)" }} />;
    case "error":
      return <CloseCircleOutlined style={{ color: "var(--color-danger)" }} />;
    default:
      return <ClockCircleOutlined style={{ color: "#b8bfcc" }} />;
  }
};

const getGroupStatus = (
  collecting: boolean,
  runningCount: number,
  errorCount: number,
  completedCount: number,
  total: number,
) => {
  if (runningCount > 0) return { label: "进行中", className: "is-running" };
  if (errorCount > 0 && completedCount === total) return { label: "部分失败", className: "is-error" };
  if (completedCount === total && total > 0) return { label: "已完成", className: "is-success" };
  if (collecting) return { label: "排队中", className: "" };
  return { label: "待开始", className: "" };
};

export default function Dashboard() {
  const {
    collecting,
    taskStates,
    progress,
    elapsed,
    successCount,
    errorCount,
    startCollectAll,
    cancelCollection,
    startSyncDashboard,
    syncingDashboard,
  } = useCollection();

  const completedCount = Object.values(taskStates).filter(
    (task) => task.status === "success" || task.status === "error",
  ).length;

  const categorySummaries = TASK_CATEGORIES.map((category) => {
    const tasks = COLLECT_TASKS.filter((task) => task.category === category);
    const states = tasks.map((task) => ({
      task,
      state: taskStates[task.key] || { status: "pending" as TaskStatus, message: "排队中" },
    }));
    const success = states.filter(({ state }) => state.status === "success").length;
    const error = states.filter(({ state }) => state.status === "error").length;
    const running = states.filter(({ state }) => state.status === "running").length;
    const completed = success + error;

    return {
      category,
      tasks: states,
      total: tasks.length,
      success,
      error,
      running,
      completed,
      percent: Math.round((completed / Math.max(1, tasks.length)) * 100),
      status: getGroupStatus(collecting, running, error, completed, tasks.length),
    };
  });

  const pageSubtitle = collecting
    ? `后台浏览器正在分批执行采集任务，已运行 ${formatTime(elapsed)}`
    : progress === 100
      ? `最近一次采集结果：${successCount} 项成功${errorCount > 0 ? `，${errorCount} 项失败` : ""}`
      : "一键采集后将按分组展示核心数据、物流、合规、广告等任务状态";

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="数据工作台"
        title="数据采集"
        subtitle={pageSubtitle}
        meta={[
          `${COLLECT_TASKS.length} 项任务`,
          collecting ? "后台批次执行" : "支持一键重跑",
        ]}
        actions={[
          <Button
            key="collect-all"
            type="primary"
            icon={<SyncOutlined />}
            onClick={startCollectAll}
            loading={collecting}
          >
            {collecting ? "采集中..." : "一键采集全部"}
          </Button>,
          collecting ? (
            <Button key="cancel" danger onClick={cancelCollection}>
              取消
            </Button>
          ) : null,
          <Tooltip key="sync-dashboard" title="仅采集仪表盘核心数据，约需 30 秒，适合快速查看最新概览" placement="bottomRight">
            <Button
              onClick={startSyncDashboard}
              loading={syncingDashboard}
            >
              {syncingDashboard ? "刷新中..." : "快速刷新概览"}
            </Button>
          </Tooltip>,
        ].filter(Boolean)}
      />

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">采集进度</div>
            <div className="app-panel__title-sub">
              {collecting ? "任务按批次在后台执行，状态每秒刷新" : "优先看各分组状态，判断哪一类任务卡住或失败"}
            </div>
          </div>
          <Space size={6} wrap>
            <Tag color="success" style={{ borderRadius: 999, margin: 0 }}>成功 {successCount}</Tag>
            <Tag color={errorCount > 0 ? "error" : "default"} style={{ borderRadius: 999, margin: 0 }}>失败 {errorCount}</Tag>
            <Tag color={collecting ? "processing" : progress === 100 ? (errorCount > 0 ? "warning" : "success") : "default"} style={{ borderRadius: 999, margin: 0 }}>
              {collecting ? `${completedCount}/${COLLECT_TASKS.length} · ${formatTime(elapsed)}` : progress === 100 ? "已完成" : "待开始"}
            </Tag>
          </Space>
        </div>

        <Progress
          percent={progress}
          status={collecting ? "active" : progress === 100 ? (errorCount > 0 ? "exception" : "success") : "normal"}
          strokeColor={{ "0%": "#e55b00", "100%": "#00b96b" }}
          showInfo={false}
          style={{ marginBottom: 16 }}
        />

        <div className="group-progress-list">
          {categorySummaries.map((group) => (
            <div key={group.category} className="group-progress-row">
              <div className="group-progress-row__head">
                <div>
                  <div className="group-progress-row__title">
                    {group.category} {group.completed}/{group.total}
                  </div>
                  <div className={`group-progress-row__status ${group.status.className}`}>
                    {group.status.label}
                    {group.running > 0 ? ` · ${group.running} 项执行中` : ""}
                    {group.error > 0 ? ` · ${group.error} 项失败` : ""}
                  </div>
                </div>
                <Tag
                  color={
                    group.status.className === "is-success" ? "success"
                    : group.status.className === "is-error" ? "error"
                    : group.status.className === "is-running" ? "processing"
                    : "default"
                  }
                  style={{ borderRadius: 999, margin: 0 }}
                >
                  {group.percent}%
                </Tag>
              </div>
              <Progress
                percent={group.percent}
                showInfo={false}
                strokeColor={group.error > 0 ? "#ff9f9f" : group.running > 0 ? "#e55b00" : "#00b96b"}
                trailColor="#f1f3f7"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">详细任务</div>
            <div className="app-panel__title-sub">默认折叠，避免 65 项任务一次性占满屏幕</div>
          </div>
        </div>

        <Collapse
          ghost
          items={categorySummaries.map((group) => ({
            key: group.category,
            label: (
              <Space size={12} wrap>
                <Text strong>{group.category}</Text>
                <Tag style={{ borderRadius: 999, margin: 0 }}>
                  {group.completed}/{group.total}
                </Tag>
                <Text type="secondary">{group.status.label}</Text>
              </Space>
            ),
            children: (
              <div style={{ display: "grid", gap: 10 }}>
                {group.tasks.map(({ task, state }) => (
                  <div
                    key={task.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                      padding: "12px 14px",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      background: state.status === "running" ? "var(--color-brand-light)" : "#fff",
                    }}
                  >
                    <Space size={10}>
                      {getTaskIcon(state.status)}
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{task.label}</div>
                        <div style={{ marginTop: 4, fontSize: 12, color: "var(--color-text-sec)" }}>
                          {state.message || (state.status === "pending" ? "排队中" : "等待更新")}
                        </div>
                      </div>
                    </Space>

                    <Space size={8} wrap>
                      {typeof state.count === "number" ? (
                        <Tag style={{ borderRadius: 999, margin: 0 }}>{state.count} 条</Tag>
                      ) : null}
                      {typeof state.duration === "number" ? (
                        <Tag style={{ borderRadius: 999, margin: 0 }}>{state.duration}s</Tag>
                      ) : null}
                      <Tag
                        color={
                          state.status === "success"
                            ? "success"
                            : state.status === "error"
                              ? "error"
                              : state.status === "running"
                                ? "processing"
                                : "default"
                        }
                        style={{ borderRadius: 999, margin: 0 }}
                      >
                        {state.status === "success"
                          ? "已完成"
                          : state.status === "error"
                            ? "失败"
                            : state.status === "running"
                              ? "采集中"
                              : "排队中"}
                      </Tag>
                    </Space>
                  </div>
                ))}
              </div>
            ),
          }))}
        />
      </div>
    </div>
  );
}
