import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  InputNumber,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  CloseCircleOutlined,
  FileExcelOutlined,
  HistoryOutlined,
  InboxOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";

const { Dragger } = Upload;
const { Title, Text } = Typography;

const api = window.electronAPI?.automation;

const SUCCESS_COLOR = "var(--color-success)";

function extractCellTexts(value: any, seen = new WeakSet<object>()): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") {
    const text = value.trim();
    return text && text !== "[object Object]" ? [text] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => extractCellTexts(item, seen));
  if (typeof value !== "object") {
    const text = String(value).trim();
    return text && text !== "[object Object]" ? [text] : [];
  }
  if (seen.has(value)) return [];
  seen.add(value);

  const objectValue = value as Record<string, any>;
  const orderedCategoryKeys = Object.keys(objectValue)
    .filter((key) => /^cat\d+$/i.test(key) || /^(first|second|third|fourth|fifth)Category/i.test(key) || /^leafCat$/i.test(key))
    .sort();
  const orderedTexts = orderedCategoryKeys.flatMap((key) => extractCellTexts(objectValue[key], seen));
  if (orderedTexts.length > 0) return orderedTexts;

  const preferredTexts = [
    objectValue.w,
    objectValue.text,
    objectValue.label,
    objectValue.name,
    objectValue.catName,
    objectValue.categoryName,
    objectValue.title,
    objectValue.v,
  ].flatMap((item) => extractCellTexts(item, seen));
  if (preferredTexts.length > 0) return preferredTexts;

  return Object.values(objectValue).flatMap((item) => extractCellTexts(item, seen));
}

function normalizeCellText(value: any, separator = ", "): string {
  const seen = new Set<string>();
  return extractCellTexts(value)
    .filter((text) => {
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .join(separator);
}

function normalizeCategoryCellText(value: any): string {
  return normalizeCellText(value, " / ");
}

function getResultDisplayName(item: any, index: number) {
  const rawName = normalizeCellText(item?.name || item?.title || item?.productName || "");
  if (rawName) return rawName;
  const rowNumber = typeof item?.index === "number" ? item.index + 1 : index + 1;
  return `第 ${rowNumber} 行商品`;
}

function getResultRowMeta(item: any, index: number) {
  const rowNumber = typeof item?.index === "number" ? item.index + 1 : index + 1;
  return `来源行：第 ${rowNumber} 行`;
}

function getBatchStatusLabel(status: string, running: boolean, paused: boolean) {
  if (paused) return "已暂停";
  if (status === "paused") return "已暂停";
  if (status === "pausing") return "暂停中";
  if (running || status === "running") return "进行中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "interrupted") return "已中断";
  return "待启动";
}

function getBatchTagColor(status: string, running: boolean, paused: boolean) {
  if (paused) return "warning";
  if (status === "paused") return "warning";
  if (status === "pausing") return "warning";
  if (running || status === "running") return "processing";
  if (status === "completed") return "success";
  if (status === "failed" || status === "interrupted") return "error";
  return "default";
}

function getHistoryStatusColor(status: string) {
  if (status === "running") return "processing";
  if (status === "pausing") return "warning";
  if (status === "paused") return "warning";
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  return "default";
}

function getHistoryStatusText(status: string) {
  if (status === "running") return "进行中";
  if (status === "pausing") return "暂停中";
  if (status === "paused") return "已暂停";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "interrupted") return "已中断";
  return status || "未知状态";
}

function BatchCreate() {

  const [filePath, setFilePath] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [startRow, setStartRow] = useState(0);
  const [count, setCount] = useState(5);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progressInfo, setProgressInfo] = useState<any>({ running: false, status: "idle" });
  const [results, setResults] = useState<any[]>([]);
  const [taskHistory, setTaskHistory] = useState<any[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [filteringTable, setFilteringTable] = useState(false);
  const [filterSummary, setFilterSummary] = useState<any>(null);
  const progressRef = useRef<any>(null);
  const runningStateRef = useRef(false);

  const stopPolling = () => {
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
  };

  const syncTaskHistory = (task: any) => {
    if (!task?.taskId) return;
    setTaskHistory((prev) => [task, ...prev.filter((item) => item?.taskId !== task.taskId)].slice(0, 10));
  };

  const applyTaskSnapshot = (task: any) => {
    if (!task) return;
    if (task.taskId) setSelectedTaskId(task.taskId);
    setProgressInfo(task);
    setResults(Array.isArray(task.results) ? task.results : []);
    setPaused(Boolean(task.paused));
    setRunning(Boolean(task.running));
    if (task.csvPath) setFilePath(task.csvPath);
    if (typeof task.startRow === "number") setStartRow(task.startRow);
    if (typeof task.count === "number" && task.count > 0) setCount(task.count);
  };

  const pollProgress = (taskId?: string, suppressNotice = false) => {
    stopPolling();
    progressRef.current = setInterval(async () => {
      try {
        const snapshot = taskId ? await api?.getTaskProgress?.(taskId) : await api?.getProgress?.();
        if (!snapshot) return;

        applyTaskSnapshot(snapshot);
        syncTaskHistory(snapshot);

        const finished = !snapshot.running
          && ["completed", "failed", "interrupted"].includes(snapshot.status || "")
          && (snapshot.taskId || snapshot.completed > 0);
        if (!finished) return;

        stopPolling();
        setRunning(false);
        setPaused(false);
        void refreshTaskHistory();

        if (suppressNotice || !runningStateRef.current) return;

        const successItems = Array.isArray(snapshot.results) ? snapshot.results.filter((item: any) => item.success).length : 0;
        const failItems = Array.isArray(snapshot.results) ? snapshot.results.filter((item: any) => !item.success).length : 0;
        if (snapshot.status === "completed") {
          message.success(`自动上品完成：成功 ${successItems} 个，失败 ${failItems} 个`);
        } else {
          message.error(snapshot.message || "自动上品任务异常结束");
        }
      } catch {
        // ignore polling errors
      }
    }, 2200);
  };

  const refreshTaskHistory = async (preserveSelection = true) => {
    try {
      setHistoryLoading(true);
      const tasks = await api?.listTasks?.();
      if (!Array.isArray(tasks)) return;

      setTaskHistory(tasks);
      if (tasks.length === 0) return;

      const preferredTask = preserveSelection
        ? tasks.find((task: any) => task?.taskId === selectedTaskId) || tasks[0]
        : tasks[0];

      if (!preferredTask) return;
      applyTaskSnapshot(preferredTask);
      if (preferredTask.running) {
        pollProgress(preferredTask.taskId, true);
      }
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  };

  const restoreTaskView = async (taskId: string) => {
    if (!taskId) return;
    try {
      const task = await api?.getTaskProgress?.(taskId);
      if (!task) return;
      applyTaskSnapshot(task);
      syncTaskHistory(task);
      if (task.running) {
        pollProgress(task.taskId, true);
      } else {
        stopPolling();
      }
      message.success("已恢复任务视图");
    } catch (error: any) {
      message.error(error?.message || "恢复任务失败");
    }
  };

  const loadPreview = async (nextFilePath: string) => {
    try {
      const data = await api?.readScrapeData?.(`csv_preview:${nextFilePath}`);
      if (!data?.rows || data.rows.length === 0) {
        message.info("文件路径已设置，可以直接开始自动上品");
        setPreview(null);
        return;
      }

      let headerRowIdx = 0;
      const columnMap: Record<string, string[]> = {
        title: ["商品标题（中文）", "商品名称", "title"],
        mainImage: ["商品主图", "商品原图"],
        carousel: ["商品轮播图"],
        category: ["后台分类", "前台分类（中文）"],
        price: ["美元价格($)", "美元价格", "price"],
      };

      for (let rowIndex = 0; rowIndex < Math.min(3, data.rows.length); rowIndex += 1) {
        const row = data.rows[rowIndex] || [];
        const rowText = row.map((cell: any) => normalizeCellText(cell)).join("|");
        if (rowText.includes("商品标题") || rowText.includes("商品主图") || rowText.includes("美元价格")) {
          headerRowIdx = rowIndex;
          break;
        }
      }

      const headers = data.rows[headerRowIdx] || [];
      const detected: Record<string, number> = {};
      Object.entries(columnMap).forEach(([key, names]) => {
        for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
          const headerText = normalizeCellText(headers[columnIndex]);
          if (names.some((name) => headerText.includes(name))) {
            detected[key] = columnIndex;
            break;
          }
        }
      });

      const dataRows = data.rows.slice(headerRowIdx + 1);
      setPreview({
        headers,
        rows: dataRows.slice(0, 5),
        total: dataRows.length,
        detected,
      });
      setCount(Math.min(dataRows.length || 1, 10));
      message.success(`已识别 ${dataRows.length} 个商品`);
    } catch {
      setPreview(null);
      message.info("文件路径已设置，可以直接开始自动上品");
    }
  };

  const resetSheetState = () => {
    stopPolling();
    setFilePath("");
    setPreview(null);
    setResults([]);
    setFilterSummary(null);
    setProgressInfo({ running: false, status: "idle" });
    setRunning(false);
    setPaused(false);
    setSelectedTaskId("");
  };

  const selectFile = async () => {
    const nextFilePath = await window.electronAPI?.selectFile?.();
    if (!nextFilePath) return;
    setFilePath(nextFilePath);
    setPreview(null);
    setResults([]);
    setFilterSummary(null);
    await loadPreview(nextFilePath);
  };

  const handleFile = async (file: any) => {
    const nextFilePath = file.path || file.name;
    if (!nextFilePath) {
      message.error("无法获取文件路径");
      return false;
    }
    setFilePath(nextFilePath);
    setPreview(null);
    setResults([]);
    setFilterSummary(null);
    await loadPreview(nextFilePath);
    return false;
  };

  const hydrateTaskState = async () => {
    try {
      const tasks = await api?.listTasks?.();
      if (Array.isArray(tasks) && tasks.length > 0) {
        setTaskHistory(tasks);
        const preferredTask = tasks.find((task: any) => task?.running) || tasks[0];
        if (preferredTask) {
          applyTaskSnapshot(preferredTask);
          if (preferredTask.running) {
            pollProgress(preferredTask.taskId, true);
          }
        }
        return;
      }

      const snapshot = await api?.getProgress?.();
      if (!snapshot) return;
      const hasTaskState = snapshot.taskId || snapshot.running || snapshot.completed || snapshot.status === "running";
      if (!hasTaskState) return;
      applyTaskSnapshot(snapshot);
      syncTaskHistory(snapshot);
      if (snapshot.running) {
        pollProgress(snapshot.taskId, true);
      }
    } catch {
      // ignore hydration errors
    }
  };

  const togglePause = async () => {
    const taskId = selectedTaskId || progressInfo?.taskId;
    if (!taskId) {
      message.warning("当前没有可操作的任务");
      return;
    }

    try {
      const task = paused ? await api?.resumePricing?.(taskId) : await api?.pausePricing?.(taskId);
      if (!task) return;
      applyTaskSnapshot(task);
      syncTaskHistory(task);
      if (task.running) {
        pollProgress(task.taskId, true);
        message.success(paused ? "任务已继续" : "暂停请求已发送，当前商品处理完后停止");
      } else {
        stopPolling();
        message.success("任务已暂停");
      }
    } catch (error: any) {
      message.error(error?.message || "操作失败");
    }
  };

  const handleFilterProductTable = async () => {
    if (!filePath) {
      message.warning("请先上传商品表格");
      return;
    }
    try {
      setFilteringTable(true);
      const response = await api?.filterProductTable?.(filePath);
      if (!response?.outputPath) {
        message.error("生成过滤后表格失败");
        return;
      }
      setFilterSummary(response);
      setFilePath(response.outputPath);
      setPreview(null);
      setResults([]);
      await loadPreview(response.outputPath);
      message.success(`已过滤 ${response.excludedRows || 0} 条高风险商品`);
    } catch (error: any) {
      message.error(error?.message || "生成过滤后表格失败");
    } finally {
      setFilteringTable(false);
    }
  };

  const handleBatch = async () => {
    if (!filePath) {
      message.warning("请先上传商品表格");
      return;
    }

    setRunning(true);
    setPaused(false);
    setResults([]);
    setProgressInfo({
      running: true,
      status: "running",
      total: count,
      completed: 0,
      current: "准备中...",
      step: "初始化",
      results: [],
    });

    try {
      const response = await api?.autoPricing?.({ csvPath: filePath, startRow, count });
      if (!response?.accepted) {
        setRunning(false);
        setPaused(false);
        if (response?.task) {
          applyTaskSnapshot(response.task);
          syncTaskHistory(response.task);
          if (response.task.running) {
            pollProgress(response.task.taskId, true);
          }
        }
        message.warning(response?.message || "已有自动上品任务在运行");
        return;
      }

      if (response?.task) {
        applyTaskSnapshot(response.task);
        syncTaskHistory(response.task);
      }
      message.success("自动上品任务已启动");
      void refreshTaskHistory(false);
      pollProgress(response?.task?.taskId);
    } catch (error: any) {
      setRunning(false);
      setPaused(false);
      message.error(error?.message || "启动自动上品失败");
    }
  };

  useEffect(() => {
    runningStateRef.current = running;
  }, [running]);

  useEffect(() => {
    void hydrateTaskState();
  }, []);

  useEffect(() => () => {
    stopPolling();
  }, []);

  const hasFile = Boolean(filePath);
  const hasPreview = Boolean(preview?.rows?.length);
  const hasResults = results.length > 0;
  const pausePending = progressInfo?.status === "pausing";
  const hasTaskProgress = Boolean(
    running
    || paused
    || progressInfo?.taskId
    || progressInfo?.completed
    || ["completed", "failed", "interrupted", "running", "pausing", "paused"].includes(progressInfo?.status),
  );
  const batchStatusLabel = getBatchStatusLabel(progressInfo?.status, running, paused);
  const batchTagColor = getBatchTagColor(progressInfo?.status, running, paused);
  const currentFileName = filePath ? filePath.split(/[/\\]/).pop() : "未选择文件";
  const successCount = results.filter((item: any) => item.success).length;
  const failCount = results.filter((item: any) => !item.success).length;
  const progressTotal = progressInfo?.total || count || 0;
  const progressPercent = progressTotal > 0 ? Math.round(((progressInfo?.completed || 0) / progressTotal) * 100) : 0;
  const completedCount = progressInfo?.completed || 0;
  const pendingCount = Math.max(progressTotal - completedCount, 0);
  const previewRows = hasPreview
    ? preview.rows.map((row: any[], index: number) => {
      const detected = preview.detected || {};
      const titleText = detected.title >= 0 ? normalizeCellText(row[detected.title]) : "";
      const carouselText = detected.carousel >= 0 ? normalizeCellText(row[detected.carousel]) : "";
      const categoryText = detected.category >= 0 ? normalizeCategoryCellText(row[detected.category]) : "";
      const priceText = detected.price >= 0 ? normalizeCellText(row[detected.price]) : "";
      return {
        key: index,
        title: titleText.slice(0, 72) || "-",
        media: `${detected.mainImage >= 0 ? "主图" : "无主图"}${carouselText ? ` · 轮播 ${carouselText.split(",").length} 张` : ""}`,
        category: categoryText.slice(0, 42) || "-",
        price: priceText ? `$${priceText}` : "-",
      };
    })
    : [];
  const visibleTaskHistory = taskHistory.slice(0, 3);
  const resultRows = results
    .map((item: any, index: number) => ({
      key: `${item?.index ?? index}-${item?.productId ?? item?.message ?? ""}`,
      ...item,
      displayName: getResultDisplayName(item, index),
      rowMeta: getResultRowMeta(item, index),
    }))
    .sort((left: any, right: any) => Number(left.success) - Number(right.success));
  const failedReasonSummary = Object.entries(
    results.reduce<Record<string, number>>((acc, item: any) => {
      if (item?.success) return acc;
      const reason = String(item?.message || "未返回错误信息").trim() || "未返回错误信息";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div className="create-flow-toolbar">
        <div className="create-flow-toolbar__summary">
          <Text className="create-flow-toolbar__eyebrow">自动化上品流程</Text>
          <Title level={4} style={{ margin: 0 }}>
            上传商品表格
          </Title>
          <Text type="secondary" className="create-flow-toolbar__desc">
            系统会自动识别标题、主图、轮播图、分类和价格列。确认无误后，可以先过滤高风险，再直接开始自动上品。
          </Text>
          <Space wrap className="app-table-meta">
            <Tag color={batchTagColor}>{batchStatusLabel}</Tag>
            {hasFile ? <Tag>{currentFileName}</Tag> : null}
            {hasFile ? <Tag>{`从第 ${startRow + 1} 行开始`}</Tag> : <Tag>还没选择文件</Tag>}
            {preview?.total ? <Tag color="blue">{`共 ${preview.total} 个商品`}</Tag> : null}
            {hasFile ? <Tag>{`本次执行 ${count} 个`}</Tag> : null}
          </Space>
        </div>

        <div className="create-flow-toolbar__controls">
          <div className="create-flow-toolbar__inputs">
            <div className="create-flow-toolbar__input">
              <span className="create-flow-toolbar__label">起始行</span>
              <InputNumber min={0} value={startRow} onChange={(value) => setStartRow(value || 0)} style={{ width: "100%" }} />
            </div>
            <div className="create-flow-toolbar__input">
              <span className="create-flow-toolbar__label">上品数量</span>
              <InputNumber min={1} max={100} value={count} onChange={(value) => setCount(value || 1)} style={{ width: "100%" }} />
            </div>
          </div>

          <div className="app-table-actions">
            <Button icon={<FileExcelOutlined />} onClick={() => void selectFile()}>
              {hasFile ? "更换文件" : "选择文件"}
            </Button>
            {hasFile ? (
              <Button icon={<ReloadOutlined />} onClick={() => void loadPreview(filePath)}>
                重新识别
              </Button>
            ) : null}
            <Button icon={<FileExcelOutlined />} disabled={!hasFile} loading={filteringTable} onClick={handleFilterProductTable}>
              过滤高风险
            </Button>
            <Button icon={<HistoryOutlined />} loading={historyLoading} onClick={() => void refreshTaskHistory()}>
              刷新任务
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              disabled={!hasFile || running}
              loading={running && !paused}
              onClick={handleBatch}
              className="create-primary-button"
            >
              {running ? "自动上品进行中..." : `开始自动上品（${count} 个）`}
            </Button>
            {running ? (
              <Button
                icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                onClick={togglePause}
                className="create-secondary-button"
                disabled={pausePending}
              >
                {pausePending ? "暂停中..." : paused ? "继续任务" : "暂停任务"}
              </Button>
            ) : null}
            {hasFile ? <Button onClick={resetSheetState}>清空文件</Button> : null}
          </div>
        </div>
      </div>

      {filterSummary ? (
        <Alert
          className="friendly-alert"
          type="info"
          showIcon
          message={`已生成过滤后表格：保留 ${filterSummary.keptRows || 0} 条，排除 ${filterSummary.excludedRows || 0} 条`}
          description={(
            <Space wrap>
              <Tag color="blue">液体 {filterSummary.excludedSummary?.liquid || 0}</Tag>
              <Tag color="purple">膏体 {filterSummary.excludedSummary?.paste || 0}</Tag>
              <Tag color="orange">带电 {filterSummary.excludedSummary?.electric || 0}</Tag>
              <Tag color="red">IP {filterSummary.excludedSummary?.ip || 0}</Tag>
            </Space>
          )}
        />
      ) : null}

      {!hasFile ? (
        <Card className="create-preview-card" style={{ borderRadius: 22, borderColor: "#eceff4" }} bodyStyle={{ padding: 24 }}>
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Dragger className="studio-dropzone" accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={handleFile}>
              <div className="studio-dropzone__inner">
                <div className="studio-dropzone__icon">
                  <InboxOutlined style={{ color: "#fff", fontSize: 28 }} />
                </div>
                <div>
                  <Title level={4} style={{ marginBottom: 8 }}>拖拽商品表格到这里</Title>
                  <Text type="secondary" className="studio-dropzone__desc">
                    支持 Excel / CSV，上传后会自动识别商品标题、图片、分类和价格列。
                  </Text>
                </div>
                <div className="studio-dropzone__actions">
                  <Button
                    type="primary"
                    icon={<FileExcelOutlined />}
                    className="create-primary-button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void selectFile();
                    }}
                  >
                    选择文件
                  </Button>
                </div>
              </div>
            </Dragger>

            <div className="create-flow-hints">
              <div className="create-flow-hint">
                <Text strong>1. 导入表格</Text>
                <Text type="secondary">上传 Excel / CSV 后，系统自动识别关键字段。</Text>
              </div>
              <div className="create-flow-hint">
                <Text strong>2. 过滤风险</Text>
                <Text type="secondary">可先剔除液体、膏体、带电、IP 等高风险商品。</Text>
              </div>
              <div className="create-flow-hint">
                <Text strong>3. 自动上品</Text>
                <Text type="secondary">按数量批量生成 Temu 草稿，并持续回传进度和结果。</Text>
              </div>
            </div>
          </Space>
        </Card>
      ) : null}

      {hasPreview ? (
        <Card style={{ borderRadius: 22, borderColor: "#eceff4" }} bodyStyle={{ padding: 0 }}>
          <div style={{ padding: 20, borderBottom: "1px solid #edf1f5", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <Title level={4} style={{ margin: 0 }}>前 5 行预览</Title>
              <Text type="secondary" style={{ display: "block", marginTop: 6 }}>
                这里只看自动化上品最关键的字段，确认标题、图片、分类和价格是否正常。
              </Text>
            </div>
            {preview?.total ? <Tag color="blue">{`共 ${preview.total} 行可处理`}</Tag> : null}
          </div>

          <Table
            dataSource={previewRows}
            columns={[
              { title: "商品标题", dataIndex: "title", key: "title", ellipsis: true },
              { title: "图片", dataIndex: "media", key: "media", width: 150 },
              { title: "分类", dataIndex: "category", key: "category", width: 260, ellipsis: true },
              { title: "价格", dataIndex: "price", key: "price", width: 100 },
            ]}
            pagination={false}
            size="small"
            scroll={{ x: 660 }}
          />
        </Card>
      ) : null}

      {hasTaskProgress ? (
        <Card className="create-result-card" style={{ borderRadius: 22, borderColor: "#eceff4" }} bodyStyle={{ padding: 24 }}>
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <Title level={4} style={{ margin: 0 }}>任务进度</Title>
                <Text type="secondary" style={{ display: "block", marginTop: 6 }}>
                  {progressInfo?.current || "等待开始"} {progressInfo?.step ? `· ${progressInfo.step}` : ""}
                </Text>
              </div>
              <Space wrap>
                <Tag color={batchTagColor}>{batchStatusLabel}</Tag>
                {progressInfo?.taskId ? <Tag>{`任务 ${progressInfo.taskId}`}</Tag> : null}
              </Space>
            </div>

            <Progress
              percent={progressPercent}
              status={paused || progressInfo?.status === "failed" || progressInfo?.status === "interrupted" ? "exception" : progressInfo?.status === "completed" ? "success" : "active"}
              format={() => `${completedCount}/${progressTotal || 0}`}
            />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
              <StatCard compact title="已处理" value={completedCount} color="brand" />
              <StatCard compact title="待处理" value={pendingCount} color="blue" />
              <StatCard compact title="成功" value={successCount} color="success" />
              <StatCard compact title="失败" value={failCount} color={failCount > 0 ? "danger" : "neutral"} />
            </div>
          </Space>
        </Card>
      ) : null}

      {(progressInfo?.status === "failed" || progressInfo?.status === "interrupted") && progressInfo?.message ? (
        <Alert type="error" showIcon message="任务执行异常" description={progressInfo.message} />
      ) : null}

      {hasResults ? (
        <Card className="create-result-card" style={{ borderRadius: 22, borderColor: "#eceff4" }} bodyStyle={{ padding: 24 }}>
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <Title level={4} style={{ margin: 0 }}>执行结果</Title>
              </div>
              <Space wrap>
                <Tag color="blue">{`共 ${results.length} 条`}</Tag>
                <Tag color="success">{`成功 ${successCount}`}</Tag>
                <Tag color="error">{`失败 ${failCount}`}</Tag>
                <Tag>{`成功率 ${results.length ? Math.round(successCount / results.length * 100) : 0}%`}</Tag>
              </Space>
            </div>

            {failedReasonSummary.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="失败原因汇总"
                description={(
                  <div style={{ display: "grid", gap: 6 }}>
                    {failedReasonSummary.map(([reason, count]) => (
                      <div key={reason} style={{ color: "var(--color-text-sec)" }}>
                        {count} 条：{reason}
                      </div>
                    ))}
                  </div>
                )}
              />
            ) : null}

            <Table
              dataSource={resultRows}
              columns={[
                {
                  title: "商品",
                  dataIndex: "displayName",
                  key: "displayName",
                  ellipsis: true,
                  render: (value: string, record: any) => (
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{value}</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-sec)", marginTop: 4 }}>{record.rowMeta}</div>
                    </div>
                  ),
                },
                {
                  title: "结果",
                  dataIndex: "success",
                  key: "success",
                  width: 100,
                  render: (value: boolean) => (
                    <Tag color={value ? "success" : "error"} icon={value ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
                      {value ? "成功" : "失败"}
                    </Tag>
                  ),
                },
                {
                  title: "详情",
                  dataIndex: "message",
                  key: "message",
                  ellipsis: true,
                  render: (value: string, record: any) => record.success
                    ? <span style={{ color: SUCCESS_COLOR }}>{`ID: ${record.productId}`}</span>
                    : <span style={{ color: "#ff4d4f" }}>{value || "未返回错误信息"}</span>,
                },
              ]}
              pagination={{ pageSize: 6, showSizeChanger: false, hideOnSinglePage: true }}
              size="small"
              scroll={{ x: 620 }}
            />
          </Space>
        </Card>
      ) : null}

      {visibleTaskHistory.length > 0 ? (
        <Card
          style={{ borderRadius: 22, borderColor: "#eceff4" }}
          title="最近任务"
          extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void refreshTaskHistory()} loading={historyLoading}>刷新</Button>}
        >
          <div className="create-history-list">
            {visibleTaskHistory.map((task) => {
              const isActive = task.taskId === selectedTaskId;
              const displayName = task.csvPath ? task.csvPath.split(/[/\\]/).pop() : "未命名任务";
              return (
                <div key={task.taskId} className={`create-history-item${isActive ? " is-active" : ""}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Space wrap>
                        <Tag color={getHistoryStatusColor(task.status)}>{getHistoryStatusText(task.status)}</Tag>
                        <Text strong ellipsis>{displayName}</Text>
                      </Space>
                      <div className="create-history-item__meta">
                        {`${task.completed || 0}/${task.total || task.count || 0} 已处理`}
                        {task.updatedAt ? ` · 最近更新 ${task.updatedAt}` : ""}
                      </div>
                      {task.message ? (
                        <div className="create-history-item__meta" style={{ color: task.status === "failed" || task.status === "interrupted" ? "#ff4d4f" : "#66758a" }}>
                          {task.message}
                        </div>
                      ) : null}
                    </div>
                    <Button size="small" onClick={() => void restoreTaskView(task.taskId)}>
                      {task.running ? "继续跟踪" : "恢复"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </Space>
  );
}

export default function ProductCreate() {
  const pageDescription = "导入表格后，系统会自动识别字段、可选过滤高风险，再直接执行自动上品。";

  return (
    <div className="dashboard-shell product-create-shell">
      <PageHeader
        compact
        eyebrow="自动化上品"
        title="上品管理"
        subtitle={pageDescription}
        actions={<Tag color="orange">批量/API 主流程</Tag>}
      />

      <div>
        <BatchCreate />
      </div>
    </div>
  );
}
