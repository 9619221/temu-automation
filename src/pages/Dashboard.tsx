import {
  Card, Row, Col, Typography, Button, Space, Tag, Progress,
} from "antd";
import {
  SyncOutlined, CheckCircleOutlined, CloseCircleOutlined,
  LoadingOutlined, ClockCircleOutlined,
} from "@ant-design/icons";
import { useCollection, COLLECT_TASKS, TASK_CATEGORIES, type TaskStatus } from "../contexts/CollectionContext";

const { Text } = Typography;

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
};

const getTaskIcon = (status: TaskStatus) => {
  switch (status) {
    case "running": return <LoadingOutlined style={{ color: "#1890ff" }} spin />;
    case "success": return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
    case "error": return <CloseCircleOutlined style={{ color: "#ff4d4f" }} />;
    default: return <ClockCircleOutlined style={{ color: "#d9d9d9" }} />;
  }
};

export default function Dashboard() {
  const {
    collecting, taskStates, progress, elapsed,
    successCount, errorCount,
    startCollectAll, cancelCollection, startSyncDashboard, syncingDashboard,
  } = useCollection();
  const completedCount = Object.values(taskStates).filter((task) => task.status === "success" || task.status === "error").length;

  return (
    <div>
      <Row justify="end" style={{ marginBottom: 16 }}>
        <Col>
          <Space>
            <Button
              type="primary"
              danger
              size="large"
              icon={<SyncOutlined />}
              onClick={startCollectAll}
              loading={collecting}
              style={{ fontWeight: 600, borderRadius: 10, height: 48, paddingInline: 28, background: "linear-gradient(135deg, #e55b00, #ff8534)", border: "none" }}
            >
              一键采集全部数据
            </Button>
            {collecting && (
              <Button
                danger
                size="large"
                onClick={cancelCollection}
                style={{ borderRadius: 10, height: 48 }}
              >
                取消采集
              </Button>
            )}
            <Button
              icon={<SyncOutlined />}
              onClick={startSyncDashboard}
              loading={syncingDashboard}
              style={{ borderRadius: 10, height: 48 }}
            >
              仅同步仪表盘
            </Button>
          </Space>
        </Col>
      </Row>

      <Card size="small" style={{ borderRadius: 12, border: "1px solid #f0f0f0", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", background: "#fafafa", borderRadius: 12, marginBottom: 16 }}>
          <Progress
            percent={progress}
            status={collecting ? "active" : progress === 100 ? (errorCount > 0 ? "exception" : "success") : "normal"}
            strokeColor={{ "0%": "#f56a00", "100%": "#52c41a" }}
            format={() => collecting ? `${completedCount}/${COLLECT_TASKS.length}` : progress === 100 ? `${successCount} 成功` : "就绪"}
          />
          {collecting && (
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <Tag color="processing" style={{ borderRadius: 12, padding: "2px 12px" }}>采集中 {formatTime(elapsed)}</Tag>
            </div>
          )}
          {!collecting && progress === 100 && (
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <Space>
                <Tag color="success" style={{ borderRadius: 12, padding: "2px 12px" }}>{successCount} 成功</Tag>
                {errorCount > 0 && <Tag color="error" style={{ borderRadius: 12, padding: "2px 12px" }}>{errorCount} 失败</Tag>}
                <Tag style={{ borderRadius: 12, padding: "2px 12px" }}>总耗时 {formatTime(elapsed)}</Tag>
              </Space>
            </div>
          )}
        </div>

        <div style={{ maxHeight: 600, overflow: "auto" }}>
          {TASK_CATEGORIES.map((cat) => {
            const catTasks = COLLECT_TASKS.filter(t => t.category === cat);
            return (
              <div key={cat}>
                <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, #fafafa, #f5f5f5)", fontWeight: 600, fontSize: 13, color: "#595959", borderBottom: "1px solid #f0f0f0", borderRadius: "8px 8px 0 0" }}>
                  {cat} ({catTasks.length})
                </div>
                {catTasks.map((task) => {
                  const state = taskStates[task.key] || { status: "pending" as TaskStatus };
                  return (
                    <div
                      key={task.key}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "8px 12px", borderBottom: "1px solid #f0f0f0",
                        background: state.status === "running" ? "#e6f7ff" : "transparent",
                        borderLeft: state.status === "running" ? "3px solid #e55b00" : state.status === "success" ? "3px solid #00b96b" : state.status === "error" ? "3px solid #ff4d4f" : "3px solid transparent",
                        borderRadius: 4, transition: "background 0.3s",
                      }}
                    >
                      <Space>
                        {getTaskIcon(state.status)}
                        <Text strong={state.status === "running"}>{task.label}</Text>
                      </Space>
                      <Space>
                        {state.status === "success" && (
                          <>
                            <Tag color="green" style={{ margin: 0, borderRadius: 4 }}>{state.message}</Tag>
                            <Text type="secondary" style={{ fontSize: 12 }}>{state.duration}s</Text>
                          </>
                        )}
                        {state.status === "error" && <Tag color="red" style={{ margin: 0, borderRadius: 4 }}>{state.message}</Tag>}
                        {state.status === "running" && <Tag color="processing" style={{ margin: 0, borderRadius: 4 }}>采集中...</Tag>}
                        {state.status === "pending" && <Text type="secondary" style={{ fontSize: 12 }}>等待中</Text>}
                      </Space>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
