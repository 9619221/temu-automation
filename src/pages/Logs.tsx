import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Input,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import EmptyGuide from "../components/EmptyGuide";
import {
  FRONTEND_LOG_STORE_KEY,
  clearFrontendLogs,
  type FrontendLogEntry,
} from "../utils/frontendLogger";

const { Text } = Typography;
const store = window.electronAPI?.store;

type LevelFilter = "all" | "log" | "info" | "warn" | "error";

function levelLabel(level: FrontendLogEntry["level"] | LevelFilter) {
  switch (level) {
    case "log":
      return "日志";
    case "info":
      return "信息";
    case "warn":
      return "警告";
    case "error":
      return "错误";
    default:
      return "全部";
  }
}

function levelColor(level: FrontendLogEntry["level"]) {
  switch (level) {
    case "error":
      return "error";
    case "warn":
      return "warning";
    case "info":
      return "processing";
    default:
      return "default";
  }
}

function sourceLabel(source: FrontendLogEntry["source"]) {
  switch (source) {
    case "window-error":
      return "页面异常";
    case "unhandledrejection":
      return "Promise异常";
    default:
      return "Console";
  }
}

function explainMessage(log: FrontendLogEntry) {
  const rawMessage = log.message || "";
  if (rawMessage.includes("[antd: Spin]") && rawMessage.includes("tip")) {
    return "这是 Ant Design 的加载提示用法警告，不一定代表业务失败。";
  }
  if (log.source === "unhandledrejection") {
    return "有 Promise 异常没有被捕获，建议顺着调用链继续排查。";
  }
  if (log.source === "window-error") {
    return "这是页面运行时异常，通常会直接影响当前功能。";
  }
  return "";
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

export default function Logs() {
  const [logs, setLogs] = useState<FrontendLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await store?.get?.(FRONTEND_LOG_STORE_KEY);
      setLogs(Array.isArray(data) ? data.slice().reverse() : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();

    const handleLog = (event: WindowEventMap["temu-frontend-log"]) => {
      setLogs((prev) => [event.detail, ...prev].slice(0, 500));
    };

    window.addEventListener("temu-frontend-log", handleLog as EventListener);
    return () => {
      window.removeEventListener("temu-frontend-log", handleLog as EventListener);
    };
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (levelFilter !== "all" && log.level !== levelFilter) {
        return false;
      }
      if (!searchText.trim()) {
        return true;
      }
      const keyword = searchText.trim().toLowerCase();
      return (
        log.message.toLowerCase().includes(keyword)
        || log.source.toLowerCase().includes(keyword)
        || log.level.toLowerCase().includes(keyword)
      );
    });
  }, [levelFilter, logs, searchText]);

  const errorCount = logs.filter((log) => log.level === "error").length;
  const warnCount = logs.filter((log) => log.level === "warn").length;
  const latestTime = logs[0]?.timestamp ? formatTime(logs[0].timestamp) : "--";

  const columns: ColumnsType<FrontendLogEntry> = [
    {
      title: "时间",
      dataIndex: "timestamp",
      key: "timestamp",
      width: 158,
      render: (value: number) => (
        <Text style={{ fontFamily: "Consolas, monospace", fontSize: 12 }}>
          {formatTime(value)}
        </Text>
      ),
    },
    {
      title: "级别",
      dataIndex: "level",
      key: "level",
      width: 88,
      render: (value: FrontendLogEntry["level"]) => <Tag color={levelColor(value)}>{levelLabel(value)}</Tag>,
    },
    {
      title: "来源",
      dataIndex: "source",
      key: "source",
      width: 110,
      render: (value: FrontendLogEntry["source"]) => <Tag>{sourceLabel(value)}</Tag>,
    },
    {
      title: "内容",
      dataIndex: "message",
      key: "message",
      render: (value: string) => (
        <div className="app-log-message app-log-message--clamp">{value}</div>
      ),
    },
    {
      title: "说明",
      key: "explanation",
      width: 260,
      render: (_: unknown, record: FrontendLogEntry) => {
        const explanation = explainMessage(record);
        return explanation ? (
          <span style={{ fontSize: 12, color: "var(--color-text-sec)" }}>{explanation}</span>
        ) : (
          <span style={{ color: "#bbb" }}>-</span>
        );
      },
    },
  ];

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="排查工作台"
        title="日志中心"
        subtitle="前端日志页，把前端异常、Promise 未处理错误和普通调试日志压缩进一个更易扫读的视图。"
        meta={[
          `${logs.length} 条日志`,
          errorCount > 0 ? `${errorCount} 条错误` : "当前无错误",
          warnCount > 0 ? `${warnCount} 条警告` : "警告较少",
        ]}
      />

      <div className="app-form-grid">
        <StatCard compact title="错误数" value={errorCount} color="danger" trend="优先看页面异常和 Promise 异常" />
        <StatCard compact title="警告数" value={warnCount} color="brand" trend="界面用法问题会集中到这里" />
        <StatCard compact title="最近一条" value={latestTime} color="blue" trend={logs[0]?.source ? `来源：${sourceLabel(logs[0].source)}` : "等待新的前端日志"} />
      </div>

      <Alert
        className="friendly-alert"
        type="info"
        showIcon
        message="这里只记录渲染层日志"
        description="默认保留最近 500 条。表格里先展示摘要，展开行后可以看完整内容和中文解释。"
      />

      <div className="app-panel">
        <div className="app-toolbar app-toolbar--logs">
          <Input.Search
            allowClear
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="搜索日志内容 / 来源 / 级别"
          />
          <Segmented<LevelFilter>
            value={levelFilter}
            onChange={(value) => setLevelFilter(value)}
            options={[
              { label: "全部", value: "all" },
              { label: "日志", value: "log" },
              { label: "信息", value: "info" },
              { label: "警告", value: "warn" },
              { label: "错误", value: "error" },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadLogs()} loading={loading}>
            刷新
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={async () => {
              await clearFrontendLogs();
              setLogs([]);
              message.success("前端日志已清空");
            }}
          >
            清空日志
          </Button>
          <div className="app-toolbar__count">共 {filteredLogs.length} 条</div>
        </div>
      </div>

      <div className="app-panel">
        {filteredLogs.length > 0 ? (
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={filteredLogs}
            columns={columns}
            pagination={{ pageSize: 24, showSizeChanger: true }}
            scroll={{ x: 920 }}
            expandable={{
              expandRowByClick: true,
              rowExpandable: (record) => Boolean(record.message || explainMessage(record)),
              expandedRowRender: (record) => (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <div>
                    <Text strong>完整日志</Text>
                    <div className="app-log-message" style={{ marginTop: 8 }}>{record.message}</div>
                  </div>
                  {explainMessage(record) ? (
                    <div>
                      <Text strong>中文说明</Text>
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-text-sec)", lineHeight: 1.7 }}>
                        {explainMessage(record)}
                      </div>
                    </div>
                  ) : null}
                </Space>
              ),
            }}
          />
        ) : (
          <EmptyGuide title="暂无前端日志" description="前端异常和调试日志将自动收集到此处" />
        )}
      </div>
    </div>
  );
}
