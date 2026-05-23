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
  WarningOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import ExtensionInstallGuide from "../components/ExtensionInstallGuide";
import {
  COLLECT_GROUPS,
  COLLECT_TASKS,
  COLLECT_TASKS_BY_KEY,
  GROUP_CATEGORIES,
  type TaskStatus,
  useCollection,
} from "../contexts/CollectionContext";

const { Text } = Typography;

type PageTaskStatus = "pending" | "running" | "success" | "partial" | "blocked" | "error";

const BLOCKED_PATTERNS = [/暂无权限/, /无权限/, /login/i, /登录/, /offline/i];

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
};

const isBlockedMessage = (message?: string) => {
  if (!message) return false;
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(message));
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

const getPageTaskStatusMeta = (status: PageTaskStatus) => {
  switch (status) {
    case "running":
      return { label: "进行中", className: "is-running", color: "processing" as const, icon: <LoadingOutlined spin /> };
    case "success":
      return { label: "已完成", className: "is-success", color: "success" as const, icon: <CheckCircleOutlined /> };
    case "partial":
      return { label: "部分完成", className: "is-running", color: "warning" as const, icon: <WarningOutlined /> };
    case "blocked":
      return { label: "权限/登录阻塞", className: "is-error", color: "warning" as const, icon: <WarningOutlined /> };
    case "error":
      return { label: "失败", className: "is-error", color: "error" as const, icon: <CloseCircleOutlined /> };
    default:
      return { label: "待开始", className: "", color: "default" as const, icon: <ClockCircleOutlined /> };
  }
};

const getPageTaskStatus = (
  collecting: boolean,
  counts: { success: number; error: number; running: number; completed: number; total: number; blocked: number },
): PageTaskStatus => {
  if (counts.running > 0) return "running";
  if (counts.blocked > 0 && counts.success === 0 && counts.completed === counts.total) return "blocked";
  if ((counts.error > 0 || counts.blocked > 0) && counts.success > 0) return "partial";
  if ((counts.error > 0 || counts.blocked > 0) && counts.completed > 0 && counts.completed < counts.total) {
    return collecting ? "running" : "partial";
  }
  if (counts.error > 0 && counts.completed === counts.total) return "error";
  if (counts.completed === counts.total && counts.total > 0) return "success";
  if (collecting) return "pending";
  return counts.completed > 0 ? "partial" : "pending";
};

export default function Dashboard() {
  const {
    collecting,
    taskStates,
    progress,
    elapsed,
    startCollectAll,
    cancelCollection,
    startSyncDashboard,
    syncingDashboard,
  } = useCollection();

  const pageTaskSummaries = COLLECT_GROUPS.map((group) => {
    const tasks = group.taskKeys
      .map((taskKey) => COLLECT_TASKS_BY_KEY[taskKey])
      .filter(Boolean)
      .map((task) => ({
        task,
        state: taskStates[task.key] || { status: "pending" as TaskStatus, message: "排队中" },
      }));

    const success = tasks.filter(({ state }) => state.status === "success").length;
    const error = tasks.filter(({ state }) => state.status === "error").length;
    const running = tasks.filter(({ state }) => state.status === "running").length;
    const blocked = tasks.filter(({ state }) => state.status === "error" && isBlockedMessage(state.message)).length;
    const completed = success + error;
    const percent = Math.round((completed / Math.max(1, tasks.length)) * 100);
    const totalCount = tasks.reduce((sum, { state }) => sum + (state.count || 0), 0);
    const maxDuration = tasks.reduce((max, { state }) => Math.max(max, state.duration || 0), 0);
    const status = getPageTaskStatus(collecting, {
      success,
      error,
      running,
      completed,
      total: tasks.length,
      blocked,
    });

    return {
      ...group,
      tasks,
      success,
      error,
      running,
      blocked,
      completed,
      total: tasks.length,
      percent,
      totalCount,
      maxDuration,
      status,
      statusMeta: getPageTaskStatusMeta(status),
    };
  });

  const categorySummaries = GROUP_CATEGORIES.map((category) => {
    const groups = pageTaskSummaries.filter((group) => group.category === category);
    const success = groups.filter((group) => group.status === "success").length;
    const partial = groups.filter((group) => group.status === "partial").length;
    const blocked = groups.filter((group) => group.status === "blocked").length;
    const error = groups.filter((group) => group.status === "error").length;
    const running = groups.filter((group) => group.status === "running").length;
    const completed = success + partial + blocked + error;
    const total = groups.length;
    const status = getPageTaskStatus(collecting, {
      success,
      error: error + partial,
      running,
      completed,
      total,
      blocked,
    });

    return {
      category,
      groups,
      success,
      partial,
      blocked,
      error,
      running,
      completed,
      total,
      percent: Math.round((completed / Math.max(1, total)) * 100),
      statusMeta: getPageTaskStatusMeta(status),
    };
  });

  const pageSuccessCount = pageTaskSummaries.filter((group) => group.status === "success").length;
  const pagePartialCount = pageTaskSummaries.filter((group) => group.status === "partial").length;
  const pageBlockedCount = pageTaskSummaries.filter((group) => group.status === "blocked").length;
  const pageErrorCount = pageTaskSummaries.filter((group) => group.status === "error").length;
  const pageRunningCount = pageTaskSummaries.filter((group) => group.status === "running").length;
  const pageCompletedCount = pageSuccessCount + pagePartialCount + pageBlockedCount + pageErrorCount;

  const pageSubtitle = collecting
    ? `后台浏览器正在分批执行采集任务，已运行 ${formatTime(elapsed)}，当前按页面任务聚合展示`
    : progress === 100
      ? `最近一次采集结果：${pageSuccessCount} 个页面任务正常${pagePartialCount > 0 ? `，${pagePartialCount} 个部分完成` : ""}${pageBlockedCount + pageErrorCount > 0 ? `，${pageBlockedCount + pageErrorCount} 个异常` : ""}`
      : "默认展示页面任务，展开后再看底层子任务，方便先定位哪个页面或工作台出问题";

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="数据工作台"
        title="数据采集"
        subtitle={pageSubtitle}
        meta={[
          `${COLLECT_GROUPS.length} 个页面任务 / ${COLLECT_TASKS.length} 个底层任务`,
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
            {collecting ? "采集中…" : "一键采集全部数据"}
          </Button>,
          collecting ? (
            <Button key="cancel" danger onClick={cancelCollection}>
              取消
            </Button>
          ) : null,
          <Tooltip key="sync-dashboard" title="仅采集仪表盘核心数据，约需 30 秒，适合快速查看最新概览" placement="bottomRight">
            <Button onClick={startSyncDashboard} loading={syncingDashboard}>
              {syncingDashboard ? "刷新中…" : "快速刷新概览"}
            </Button>
          </Tooltip>,
        ].filter(Boolean)}
      />

      <ExtensionInstallGuide />

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">页面任务进度</div>
            <div className="app-panel__title-sub">
              {collecting ? "进度条仍按底层任务推进，下面优先看页面任务和工作台状态" : "先定位页面级异常，再展开查看具体失败子任务"}
            </div>
          </div>
          <Space size={6} wrap>
            {pageRunningCount > 0 ? <Tag color="processing" style={{ borderRadius: 999, margin: 0 }}>进行中 {pageRunningCount}</Tag> : null}
            <Tag color="success" style={{ borderRadius: 999, margin: 0 }}>正常 {pageSuccessCount}</Tag>
            <Tag color={pagePartialCount > 0 ? "warning" : "default"} style={{ borderRadius: 999, margin: 0 }}>部分完成 {pagePartialCount}</Tag>
            <Tag color={pageBlockedCount > 0 ? "warning" : "default"} style={{ borderRadius: 999, margin: 0 }}>阻塞 {pageBlockedCount}</Tag>
            <Tag color={pageErrorCount > 0 ? "error" : "default"} style={{ borderRadius: 999, margin: 0 }}>失败 {pageErrorCount}</Tag>
            <Tag
              color={collecting ? "processing" : progress === 100 ? (pageBlockedCount + pageErrorCount > 0 ? "warning" : "success") : "default"}
              style={{ borderRadius: 999, margin: 0 }}
            >
              {collecting ? `${pageCompletedCount}/${COLLECT_GROUPS.length} - ${formatTime(elapsed)}` : progress === 100 ? "已完成" : "待开始"}
            </Tag>
          </Space>
        </div>

        <Progress
          percent={progress}
          status={collecting ? "active" : progress === 100 ? (pageBlockedCount + pageErrorCount > 0 ? "exception" : "success") : "normal"}
          strokeColor={{ "0%": "#e55b00", "100%": "#00b96b" }}
          showInfo={false}
          style={{ marginBottom: 16 }}
        />

        <div style={{ display: "grid", gap: 18 }}>
          {categorySummaries.map((category) => (
            <div key={category.category} style={{ display: "grid", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <Space size={10} wrap>
                  <Text strong style={{ fontSize: 16 }}>{category.category}</Text>
                  <Tag style={{ borderRadius: 999, margin: 0 }}>
                    {category.completed}/{category.total} 页面任务
                  </Tag>
                  <Text type="secondary">{category.statusMeta.label}</Text>
                </Space>
                <Space size={8} wrap>
                  {category.running > 0 ? <Tag color="processing" style={{ borderRadius: 999, margin: 0 }}>进行中 {category.running}</Tag> : null}
                  {category.partial > 0 ? <Tag color="warning" style={{ borderRadius: 999, margin: 0 }}>部分完成 {category.partial}</Tag> : null}
                  {category.blocked > 0 ? <Tag color="warning" style={{ borderRadius: 999, margin: 0 }}>阻塞 {category.blocked}</Tag> : null}
                  {category.error > 0 ? <Tag color="error" style={{ borderRadius: 999, margin: 0 }}>失败 {category.error}</Tag> : null}
                  <Tag color={category.statusMeta.color} style={{ borderRadius: 999, margin: 0 }}>
                    {category.percent}%
                  </Tag>
                </Space>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {category.groups.map((group) => (
                  <div key={group.key} className="group-progress-row">
                    <div className="group-progress-row__head">
                      <div>
                        <div className="group-progress-row__title">
                          {group.label} {group.completed}/{group.total}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, color: "var(--color-text-sec)" }}>
                          {group.description}
                        </div>
                        <div className={`group-progress-row__status ${group.statusMeta.className}`}>
                          {group.statusMeta.label}
                          {group.running > 0 ? ` 路 ${group.running} 项执行中` : ""}
                          {group.error > 0 ? ` 路 ${group.error} 项失败` : ""}
                          {group.blocked > 0 ? ` 路 ${group.blocked} 项阻塞` : ""}
                        </div>
                      </div>
                      <Space size={8} wrap>
                        {group.totalCount > 0 ? (
                          <Tag style={{ borderRadius: 999, margin: 0 }}>{group.totalCount} 条</Tag>
                        ) : null}
                        {group.maxDuration > 0 ? (
                          <Tag style={{ borderRadius: 999, margin: 0 }}>{group.maxDuration}s</Tag>
                        ) : null}
                        <Tag color={group.statusMeta.color} style={{ borderRadius: 999, margin: 0 }}>
                          {group.percent}%
                        </Tag>
                      </Space>
                    </div>
                    <Progress
                      percent={group.percent}
                      showInfo={false}
                      strokeColor={
                        group.status === "blocked"
                          ? "#ffb75e"
                          : group.error > 0
                            ? "#ff9f9f"
                            : group.running > 0 || group.status === "partial"
                              ? "#e55b00"
                              : "#00b96b"
                      }
                      trailColor="#f1f3f7"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">底层子任务</div>
            <div className="app-panel__title-sub">按页面任务折叠，只有需要排查时再展开看具体子任务与错误信息</div>
          </div>
        </div>

        <Collapse
          ghost
          items={categorySummaries.map((category) => ({
            key: category.category,
            label: (
              <Space size={12} wrap>
                <Text strong>{category.category}</Text>
                <Tag style={{ borderRadius: 999, margin: 0 }}>
                  {category.completed}/{category.total} 页面任务
                </Tag>
                <Text type="secondary">{category.statusMeta.label}</Text>
              </Space>
            ),
            children: (
              <div style={{ display: "grid", gap: 12 }}>
                {category.groups.map((group) => (
                  <Collapse
                    key={group.key}
                    ghost
                    items={[
                      {
                        key: group.key,
                        label: (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 16,
                              width: "100%",
                              flexWrap: "wrap",
                            }}
                          >
                            <Space size={12} wrap>
                              {group.statusMeta.icon}
                              <Text strong>{group.label}</Text>
                              <Tag style={{ borderRadius: 999, margin: 0 }}>
                                {group.completed}/{group.total}
                              </Tag>
                              <Text type="secondary">{group.description}</Text>
                            </Space>
                            <Space size={8} wrap>
                              {group.blocked > 0 ? <Tag color="warning" style={{ borderRadius: 999, margin: 0 }}>阻塞 {group.blocked}</Tag> : null}
                              {group.error > 0 ? <Tag color="error" style={{ borderRadius: 999, margin: 0 }}>失败 {group.error}</Tag> : null}
                              <Tag color={group.statusMeta.color} style={{ borderRadius: 999, margin: 0 }}>
                                {group.statusMeta.label}
                              </Tag>
                            </Space>
                          </div>
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
                                  {state.status === "error" && isBlockedMessage(state.message) ? (
                                    <Tag color="warning" style={{ borderRadius: 999, margin: 0 }}>阻塞</Tag>
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
                      },
                    ]}
                  />
                ))}
              </div>
            ),
          }))}
        />
      </div>
    </div>
  );
}
