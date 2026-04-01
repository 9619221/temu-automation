import { useState, useEffect, useRef } from "react";
import {
  Alert, Tabs, Card, Form, Input, InputNumber, Button, Space, Table, Tag,
  message, Progress, Upload, Row, Col, Statistic, Descriptions,
} from "antd";
import {
  PlusOutlined, RocketOutlined, FileExcelOutlined,
  CloudUploadOutlined, PauseCircleOutlined, PlayCircleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, InboxOutlined,
} from "@ant-design/icons";
import { setStoreValueForActiveAccount } from "../utils/multiStore";

const { TextArea } = Input;
const { Dragger } = Upload;
const api = (window as any).electronAPI?.automation;
const store = (window as any).electronAPI?.store;

// ========== Tab 1: 单个上品 ==========
function SingleCreate() {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      setResult(null);

      const res = await api?.createProduct({
        title: values.title,
        categorySearch: values.title,
        price: values.price,
        generateAI: true,
        aiImageTypes: ["hero", "lifestyle", "closeup"],
        autoSubmit: false,
        keepOpen: true,
        sourceImage: values.sourceImage || undefined,
      });
      setResult(res);

      if (res?.success) {
        message.success("上品成功！");
        const history = (await store?.get("temu_create_history")) || [];
        history.unshift({ title: values.title, price: values.price, status: "draft", createdAt: Date.now(), result: res });
        await setStoreValueForActiveAccount(store, "temu_create_history", history.slice(0, 100));
      } else {
        message.error(res?.message || "上品失败");
      }
    } catch (e: any) {
      message.error(e.message || "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title={<span><PlusOutlined style={{ color: "#e55b00", marginRight: 8 }} />商品信息</span>} style={{ borderRadius: 12 }}>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="商品标题" rules={[{ required: true, message: "请输入标题" }]}>
            <TextArea rows={2} placeholder="输入商品标题，系统自动匹配分类 + AI生成9张图（不保留原主图）" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="price" label="申报价格 (¥)" rules={[{ required: true, message: "请输入价格" }]}>
                <InputNumber min={0.01} step={0.1} style={{ width: "100%" }} placeholder="30.00" />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="sourceImage" label="参考图片路径（可选）">
                <Input placeholder="拖入图片文件或输入路径" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card style={{ borderRadius: 12 }}>
        <Space>
          <Button type="primary" icon={<RocketOutlined />} size="large" loading={submitting} onClick={handleSubmit}
            style={{ background: "#e55b00", borderColor: "#e55b00", height: 48, paddingInline: 32, fontSize: 16 }}>
            {submitting ? "上品中..." : "开始上品"}
          </Button>
          <Button size="large" onClick={() => { form.resetFields(); setResult(null); }}>重置</Button>
        </Space>
        {result && (
          <div style={{ marginTop: 16, padding: 12, background: result.success ? "#f6ffed" : "#fff2f0", borderRadius: 8 }}>
            <Tag color={result.success ? "success" : "error"} style={{ fontSize: 14, padding: "4px 12px" }}>
              {result.success ? "上品成功" : "上品失败"}
            </Tag>
            <span style={{ marginLeft: 8, color: "#666" }}>{result.message}</span>
          </div>
        )}
      </Card>
    </Space>
  );
}

// ========== Tab 2: 批量上品 ==========
function BatchCreate() {
  const [filePath, setFilePath] = useState("");
  const [preview, setPreview] = useState<any>(null); // { headers, rows, detected }
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

  const syncTaskHistory = (task: any) => {
    if (!task?.taskId) return;
    setTaskHistory((prev) => {
      const next = [task, ...prev.filter((item) => item?.taskId !== task.taskId)];
      return next.slice(0, 10);
    });
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
      if (preferredTask) applyTaskSnapshot(preferredTask);
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
      } else if (progressRef.current) {
        clearInterval(progressRef.current);
        progressRef.current = null;
      }
      message.success("已恢复任务视图");
    } catch (error: any) {
      message.error(error?.message || "恢复任务失败");
    }
  };

  // 通过 Electron 原生对话框选择文件
  const selectFile = async () => {
    const fp = await (window as any).electronAPI?.selectFile?.();
    if (!fp) return;
    setFilePath(fp);
    setPreview(null);
    setResults([]);
    setFilterSummary(null);
    await loadPreview(fp);
  };

  // 拖拽上传处理
  const handleFile = async (file: any) => {
    const fp = file.path || file.name;
    if (!fp) { message.error("无法获取文件路径"); return false; }
    setFilePath(fp);
    setPreview(null);
    setResults([]);
    setFilterSummary(null);
    await loadPreview(fp);
    return false;
  };

  // 加载预览
  const loadPreview = async (fp: string) => {

    try {
      const data = await api?.readScrapeData?.("csv_preview:" + fp);
      if (data?.rows && data.rows.length > 0) {
        // 智能检测表头行（可能有合并表头，真实列名在第1或2行）
        let headerRowIdx = 0;
        const colMap: Record<string, string[]> = {
          title: ["商品标题（中文）", "商品名称", "title"],
          mainImage: ["商品主图", "商品原图"],
          carousel: ["商品轮播图"],
          category: ["后台分类", "前台分类（中文）"],
          price: ["美元价格($)", "美元价格", "price"],
        };
        // 扫描前3行找到含"商品标题"或"商品主图"的行作为表头
        for (let r = 0; r < Math.min(3, data.rows.length); r++) {
          const row = data.rows[r] || [];
          const rowStr = row.map((c: any) => String(c || "")).join("|");
          if (rowStr.includes("商品标题") || rowStr.includes("商品主图") || rowStr.includes("美元价格")) {
            headerRowIdx = r;
            break;
          }
        }

        const headers = data.rows[headerRowIdx] || [];
        const detected: Record<string, number> = {};
        for (const [key, names] of Object.entries(colMap)) {
          for (let c = 0; c < headers.length; c++) {
            if (names.some(n => String(headers[c]).includes(n))) {
              detected[key] = c;
              break;
            }
          }
        }

        const dataStartIdx = headerRowIdx + 1;
        const dataRows = data.rows.slice(dataStartIdx);
        setPreview({
          headers,
          rows: dataRows.slice(0, 5), // 前5行数据
          total: dataRows.length,
          detected,
        });
        setCount(Math.min(dataRows.length, 10));
        message.success(`已加载 ${dataRows.length} 个商品`);
      }
    } catch {
      message.info("文件路径已设置，可以直接开始上品");
    }
  };

  // 进度轮询（核心：前端状态完全由轮询驱动，不依赖 autoPricing 的 await 返回）
  const pollProgress = (taskId?: string, suppressNotice = false) => {
    if (progressRef.current) clearInterval(progressRef.current);
    progressRef.current = setInterval(async () => {
      try {
        const p = taskId ? await api?.getTaskProgress?.(taskId) : await api?.getProgress?.();
        if (p) {
          applyTaskSnapshot(p);
          syncTaskHistory(p);
          if (!p.running && (p.taskId || p.completed > 0 || ["completed", "failed", "interrupted"].includes(p.status))) {
            // Worker 完成，更新前端状态
            clearInterval(progressRef.current);
            progressRef.current = null;
            setRunning(false);
            setPaused(false);
            refreshTaskHistory().catch(() => {});
            const shouldNotify = !suppressNotice && runningStateRef.current;
            const sc = (p.results || []).filter((r: any) => r.success).length;
            const fc = (p.results || []).filter((r: any) => !r.success).length;
            if (shouldNotify) {
              if (p.status === "failed" || p.status === "interrupted") {
                message.error(p.message || "批量上品任务已中断");
              } else if (sc > 0) {
                message.success(`批量上品完成：${sc} 成功，${fc} 失败`);
              } else if (fc > 0) {
                message.error(`批量上品全部失败（${fc}个）`);
              }
            }
          }
        }
      } catch {}
    }, 3000);
  };

  const hydrateTaskState = async () => {
    try {
      const tasks = await api?.listTasks?.();
      if (Array.isArray(tasks) && tasks.length > 0) {
        setTaskHistory(tasks);
        const latestTask = tasks[0];
        applyTaskSnapshot(latestTask);
        if (latestTask.running) {
          pollProgress(latestTask.taskId, true);
        }
        return;
      }

      const task = await api?.getProgress?.();
      if (!task) return;
      const hasTaskState = Boolean(
        task.taskId
        || task.running
        || task.completed > 0
        || (Array.isArray(task.results) && task.results.length > 0)
        || (task.status && task.status !== "idle")
      );
      if (!hasTaskState) return;
      applyTaskSnapshot(task);
      syncTaskHistory(task);
      if (task.running) {
        pollProgress(task.taskId, true);
      }
    } catch {}
  };

  // 暂停/继续
  const togglePause = async () => {
    try {
      const taskId = selectedTaskId || progressInfo?.taskId;
      if (paused) {
        await api?.resumePricing?.(taskId);
        message.info("已恢复");
      } else {
        await api?.pausePricing?.(taskId);
        message.warning("已暂停，当前商品处理完后停止");
      }
      const task = taskId ? await api?.getTaskProgress?.(taskId) : await api?.getProgress?.();
      if (task) {
        applyTaskSnapshot(task);
        syncTaskHistory(task);
      }
    } catch (err: any) {
      message.error(err?.message || "操作失败");
    }
  };

  const handleFilterProductTable = async () => {
    if (!filePath) {
      message.warning("请先上传表格文件");
      return;
    }
    try {
      setFilteringTable(true);
      const result = await api?.filterProductTable?.(filePath);
      if (!result?.outputPath) {
        message.error("生成排除后表格失败");
        return;
      }
      setFilterSummary(result);
      setFilePath(result.outputPath);
      setPreview(null);
      setResults([]);
      await loadPreview(result.outputPath);
      message.success(`已排除 ${result.excludedRows || 0} 条，生成新表格`);
    } catch (error: any) {
      message.error(error?.message || "生成排除后表格失败");
    } finally {
      setFilteringTable(false);
    }
  };

  // 开始批量上品
  const handleBatch = async () => {
    if (!filePath) {
      message.warning("请先上传表格文件");
      return;
    }
    setRunning(true);
    setPaused(false);
    setResults([]);
    setProgressInfo({ running: true, status: "running", total: count, completed: 0, current: "准备中...", step: "初始化", results: [] });

    try {
      const response = await api?.autoPricing({ csvPath: filePath, startRow, count });
      if (!response?.accepted) {
        setRunning(false);
        setPaused(false);
        if (response?.task) {
          applyTaskSnapshot(response.task);
          syncTaskHistory(response.task);
        }
        message.warning(response?.message || "已有批量上品任务在运行");
        if (response?.task?.running) pollProgress(response.task.taskId, true);
        return;
      }

      if (response?.task) {
        applyTaskSnapshot(response.task);
        syncTaskHistory(response.task);
      }
      message.success("批量上品任务已启动");
      refreshTaskHistory(false).catch(() => {});

      // 轮询进度（每3秒），直到 Worker 报告 running=false
      pollProgress(response?.task?.taskId);
    } catch (err: any) {
      setRunning(false);
      setPaused(false);
      message.error(err?.message || "启动批量上品失败");
    }
  };

  useEffect(() => {
    runningStateRef.current = running;
  }, [running]);

  useEffect(() => {
    hydrateTaskState();
  }, []);

  useEffect(() => {
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, []);

  const successCount = results.filter((r: any) => r.success).length;
  const failCount = results.filter((r: any) => !r.success).length;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* 上传区域 */}
      <Card title={<span><FileExcelOutlined style={{ color: "#00b96b", marginRight: 8 }} />上传商品表格</span>} style={{ borderRadius: 12 }}>
        {!filePath ? (
          <div>
            <Dragger
              accept=".xlsx,.xls,.csv"
              showUploadList={false}
              beforeUpload={handleFile}
              style={{ padding: "20px 0" }}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined style={{ color: "#e55b00", fontSize: 48 }} /></p>
              <p className="ant-upload-text" style={{ fontSize: 16 }}>拖拽 Excel / CSV 文件到此处</p>
              <p className="ant-upload-hint">支持 .xlsx .xls .csv 格式</p>
            </Dragger>
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <Button type="primary" icon={<FileExcelOutlined />} onClick={selectFile}
                style={{ background: "#e55b00", borderColor: "#e55b00" }}>
                选择文件
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <Space>
                <Tag color="green" style={{ fontSize: 14, padding: "4px 12px" }}>
                  <FileExcelOutlined /> {filePath.split(/[/\\]/).pop()}
                </Tag>
                {preview && <span style={{ color: "#999" }}>共 {preview.total} 个商品</span>}
              </Space>
              <Space>
                <Button size="small" loading={filteringTable} onClick={handleFilterProductTable}>
                  排除液体/膏体/带电/IP
                </Button>
                <Button size="small" onClick={() => { setFilePath(""); setPreview(null); setResults([]); setFilterSummary(null); }}>
                  更换文件
                </Button>
              </Space>
            </div>

            {filterSummary && (
              <Alert
                style={{ marginBottom: 16 }}
                type="info"
                showIcon
                message={`已生成新表格：保留 ${filterSummary.keptRows || 0} 条，排除 ${filterSummary.excludedRows || 0} 条`}
                description={(
                  <Space wrap>
                    <Tag color="blue">液体 {filterSummary.excludedSummary?.liquid || 0}</Tag>
                    <Tag color="purple">膏体 {filterSummary.excludedSummary?.paste || 0}</Tag>
                    <Tag color="orange">带电 {filterSummary.excludedSummary?.electric || 0}</Tag>
                    <Tag color="red">IP {filterSummary.excludedSummary?.ip || 0}</Tag>
                  </Space>
                )}
              />
            )}

            {/* 识别到的列 */}
            {preview?.detected && (
              <Descriptions size="small" bordered column={3} style={{ marginBottom: 16 }}>
                {Object.entries(preview.detected as Record<string, number>).map(([key, col]) => {
                  const labels: Record<string, string> = { title: "商品标题", mainImage: "商品主图", carousel: "轮播图", category: "后台分类", price: "价格" };
                  return (
                    <Descriptions.Item key={key} label={labels[key] || key}>
                      <Tag color="blue">列{(col as number) + 1}: {String(preview.headers[col as number] || "").slice(0, 15)}</Tag>
                    </Descriptions.Item>
                  );
                })}
              </Descriptions>
            )}

            {/* 预览表格 */}
            {preview?.rows && (
              <Table
                dataSource={preview.rows.map((row: any[], i: number) => {
                  const d = preview.detected || {};
                  return {
                    key: i,
                    title: d.title >= 0 ? String(row[d.title] || "").slice(0, 40) : "-",
                    image: d.mainImage >= 0 ? "有" : "-",
                    carousel: d.carousel >= 0 && row[d.carousel] ? String(row[d.carousel]).split(",").length + "张" : "-",
                    category: d.category >= 0 ? String(row[d.category] || "").slice(0, 25) : "-",
                    price: d.price >= 0 ? "$" + row[d.price] : "-",
                  };
                })}
                columns={[
                  { title: "#", key: "idx", width: 40, render: (_: any, __: any, i: number) => i + 1 },
                  { title: "商品标题", dataIndex: "title", key: "title", ellipsis: true },
                  { title: "主图", dataIndex: "image", key: "image", width: 50, render: (v: string) => v === "有" ? <Tag color="green">有</Tag> : <Tag>无</Tag> },
                  { title: "轮播图", dataIndex: "carousel", key: "carousel", width: 70 },
                  { title: "分类", dataIndex: "category", key: "category", width: 180, ellipsis: true },
                  { title: "价格", dataIndex: "price", key: "price", width: 70 },
                ]}
                pagination={false}
                size="small"
                bordered
                style={{ fontSize: 12 }}
              />
            )}

            {/* 配置 */}
            <Row gutter={16} style={{ marginTop: 16 }}>
              <Col span={8}>
                <Form.Item label="起始行" style={{ marginBottom: 0 }}>
                  <InputNumber min={0} value={startRow} onChange={(v) => setStartRow(v || 0)} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="上品数量" style={{ marginBottom: 0 }}>
                  <InputNumber min={1} max={100} value={count} onChange={(v) => setCount(v || 1)} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8} style={{ display: "flex", alignItems: "end" }}>
                <Tag color="orange" style={{ padding: "4px 12px", fontSize: 13 }}>AI 自动生成9张商品图（不保留原主图）</Tag>
              </Col>
            </Row>
          </div>
        )}
      </Card>

      {/* 操作按钮 */}
      {filePath && (
        <Card style={{ borderRadius: 12 }}>
          <Space>
            <Button type="primary" icon={<CloudUploadOutlined />} size="large" loading={running && !paused} onClick={handleBatch} disabled={running}
              style={{ background: "#00b96b", borderColor: "#00b96b", height: 48, paddingInline: 32, fontSize: 16 }}>
              {running ? "批量上品中..." : `开始批量上品 (${count}个)`}
            </Button>
            {running && (
              <Button
                size="large"
                icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                onClick={togglePause}
                style={{ height: 48, paddingInline: 24, fontSize: 16, borderColor: paused ? "#00b96b" : "#faad14", color: paused ? "#00b96b" : "#faad14" }}
              >
                {paused ? "继续" : "暂停"}
              </Button>
            )}
          </Space>

          {(progressInfo?.status === "failed" || progressInfo?.status === "interrupted") && progressInfo?.message && (
            <Alert
              style={{ marginTop: 16 }}
              type="error"
              showIcon
              message={progressInfo.message}
            />
          )}

          {/* 进度条 */}
          {running && (
            <div style={{ marginTop: 16 }}>
              <Progress
                percent={progressInfo.total > 0 ? Math.round((progressInfo.completed / progressInfo.total) * 100) : 0}
                status={paused ? "exception" : "active"}
                format={() => `${progressInfo.completed || 0}/${progressInfo.total || count}`}
              />
              <div style={{ marginTop: 8, color: "#666", fontSize: 13 }}>
                <span style={{ marginRight: 16 }}>{progressInfo.current || "准备中..."}</span>
                <Tag color={paused ? "warning" : "processing"}>{paused ? "已暂停" : progressInfo.step || "等待"}</Tag>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* 结果 */}
      {results.length > 0 && (
        <Card title="上品结果" style={{ borderRadius: 12 }}>
          <Row gutter={24} style={{ marginBottom: 16 }}>
            <Col><Statistic title="总计" value={results.length} valueStyle={{ fontSize: 20 }} /></Col>
            <Col><Statistic title="成功" value={successCount} valueStyle={{ fontSize: 20, color: "#00b96b" }} /></Col>
            <Col><Statistic title="失败" value={failCount} valueStyle={{ fontSize: 20, color: "#ff4d4f" }} /></Col>
            <Col><Statistic title="成功率" value={results.length > 0 ? Math.round(successCount / results.length * 100) : 0} suffix="%" valueStyle={{ fontSize: 20, color: "#1890ff" }} /></Col>
          </Row>

          <Table
            dataSource={results.map((r: any, i: number) => ({ key: i, ...r }))}
            columns={[
              { title: "#", key: "idx", width: 45, render: (_: any, __: any, i: number) => i + 1 },
              { title: "商品", dataIndex: "name", key: "name", ellipsis: true, render: (v: string) => <span style={{ fontSize: 13 }}>{(v || "").slice(0, 45)}</span> },
              {
                title: "状态", dataIndex: "success", key: "status", width: 80,
                render: (v: boolean) => <Tag color={v ? "success" : "error"} icon={v ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>{v ? "成功" : "失败"}</Tag>,
              },
              {
                title: "详情", dataIndex: "message", key: "msg", ellipsis: true,
                render: (v: string, r: any) => r.success
                  ? <span style={{ color: "#00b96b" }}>ID: {r.productId}</span>
                  : <span style={{ color: "#ff4d4f", fontSize: 12 }}>{(v || "").slice(0, 55)}</span>,
              },
            ]}
            pagination={false}
            size="small"
            bordered={false}
          />
        </Card>
      )}

      {taskHistory.length > 0 && (
        <Card
          title="最近任务"
          extra={(
            <Button size="small" onClick={() => refreshTaskHistory()} loading={historyLoading}>
              刷新任务
            </Button>
          )}
          style={{ borderRadius: 12 }}
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {taskHistory.map((task) => {
              const isActive = task.taskId === selectedTaskId;
              const statusColorMap: Record<string, string> = {
                running: "processing",
                paused: "warning",
                completed: "success",
                failed: "error",
                interrupted: "default",
              };
              const statusTextMap: Record<string, string> = {
                running: "进行中",
                paused: "已暂停",
                completed: "已完成",
                failed: "失败",
                interrupted: "已中断",
              };
              const displayName = task.csvPath ? task.csvPath.split(/[/\\]/).pop() : "未命名任务";
              return (
                <div
                  key={task.taskId}
                  style={{
                    border: isActive ? "1px solid #1677ff" : "1px solid #f0f0f0",
                    borderRadius: 10,
                    padding: 12,
                    background: isActive ? "#f0f7ff" : "#fff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <Space wrap>
                        <Tag color={statusColorMap[task.status] || "default"}>
                          {statusTextMap[task.status] || task.status || "未知状态"}
                        </Tag>
                        <span style={{ fontWeight: 500 }}>{displayName}</span>
                      </Space>
                      <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                        {task.completed || 0}/{task.total || task.count || 0} 已处理
                        {task.updatedAt ? `，最近更新 ${task.updatedAt}` : ""}
                      </div>
                      {task.message && (
                        <div style={{ marginTop: 6, color: task.status === "failed" || task.status === "interrupted" ? "#ff4d4f" : "#666", fontSize: 12 }}>
                          {task.message}
                        </div>
                      )}
                    </div>
                    <Button size="small" onClick={() => restoreTaskView(task.taskId)}>
                      {task.running ? "继续跟踪" : "查看结果"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </Space>
        </Card>
      )}
    </Space>
  );
}

// ========== 主页面 ==========
export default function ProductCreate() {
  return (
    <div style={{ maxWidth: 1000 }}>
      <Tabs
        defaultActiveKey="batch"
        type="card"
        items={[
          {
            key: "batch",
            label: <span><FileExcelOutlined style={{ marginRight: 4 }} />批量上品</span>,
            children: <BatchCreate />,
          },
          {
            key: "single",
            label: <span><PlusOutlined style={{ marginRight: 4 }} />单个上品</span>,
            children: <SingleCreate />,
          },
        ]}
      />
    </div>
  );
}
