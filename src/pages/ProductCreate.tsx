import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  InputNumber,
  Progress,
  Segmented,
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
import type { ColumnsType } from "antd/es/table";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";

const { Dragger } = Upload;
const { Title, Text } = Typography;

const api = window.electronAPI?.automation;
const SUCCESS_COLOR = "var(--color-success)";
const PRODUCT_CREATE_MODE_STORAGE_KEY = "temu-product-create-mode";
const PRODUCT_CREATE_REVIEW_STORAGE_KEY = "temu-product-create-reviewed-tasks";

type BatchCreateMode = "classic" | "workflow";
type WorkflowStatus = "pending" | "ready" | "running" | "success" | "warning";

function getTaskFlowType(task: any): BatchCreateMode {
  const raw = String(task?.flowType || task?.mode || task?.taskType || "");
  if (raw === "workflow" || raw === "new-workflow" || raw === "workflow_pack") return "workflow";
  if (/^workflow_pack_/.test(String(task?.taskId || ""))) return "workflow";
  return "classic";
}

function normalizeTaskForFlow(task: any, fallbackMode: BatchCreateMode): any {
  if (!task) return task;
  const flowType = task.flowType ? getTaskFlowType(task) : fallbackMode;
  return { ...task, flowType };
}

type ValidationIssue = {
  key: string;
  label: string;
  count: number;
  hint: string;
};

type ValidationSummary = {
  totalRows: number;
  requiredHeadersMissing: string[];
  suggestedHeadersMissing: string[];
  blockingIssues: ValidationIssue[];
  warningIssues: ValidationIssue[];
  canProceed: boolean;
};

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

function getResultSuccessIdentity(item: any) {
  return (
    item?.productDraftId
    || item?.draftId
    || item?.productId
    || item?.skcId
    || item?.skuId
    || item?.result?.productDraftId
    || item?.result?.draftId
    || item?.result?.productId
    || item?.result?.skcId
    || item?.result?.skuId
    || ""
  );
}

function getResultSuccessDetail(item: any) {
  if (item?.workflowStage === "material_upload" && item?.message) return item.message;

  const draftId = item?.productDraftId || item?.draftId || item?.result?.productDraftId || item?.result?.draftId;
  const productId = item?.productId || item?.result?.productId;
  const skcId = item?.skcId || item?.result?.skcId;
  const skuId = item?.skuId || item?.result?.skuId;

  const parts = [
    draftId ? `草稿ID: ${draftId}` : "",
    productId ? `商品ID: ${productId}` : "",
    skcId ? `SKC ID: ${skcId}` : "",
    skuId ? `SKU ID: ${skuId}` : "",
  ].filter(Boolean);

  return parts.join(" · ") || "已保存";
}

function getBatchStatusLabel(status: string, running: boolean, paused: boolean) {
  if (paused) return "已暂停";
  if (status === "paused") return "已暂停";
  if (status === "pausing") return "暂停中";
  if (running || status === "running") return "处理中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "interrupted") return "已中断";
  return "待开始";
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
  if (status === "running") return "处理中";
  if (status === "pausing") return "暂停中";
  if (status === "paused") return "已暂停";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "interrupted") return "已中断";
  return status || "未知状态";
}

// Worker 传来的 errorCategory 形如 "stage:rootCause"，例如 "image_gen:network"
// stage: source_download | image_gen | image_upload | category | draft | skipped | unknown
// rootCause: network | auth | quota | worker_down | timeout | unknown
const ERROR_CATEGORY_HINTS: Record<string, string> = {
  "source_download:network": "原图下载失败：网络异常，请检查网络或代理设置",
  "source_download:timeout": "原图下载超时，请稍后重试",
  "source_download:unknown": "原图下载失败，请检查商品原图链接是否可访问",

  "image_gen:network": "素材准备失败：无法连接服务，请检查网络/代理（常见于系统代理拦截 grsaiapi.com / vectorengine.ai）",
  "image_gen:auth": "素材准备失败：API 密钥无效或已过期，请在设置 → AI 服务中更新密钥",
  "image_gen:quota": "素材准备失败：额度不足或已触发限流，请充值或稍后再试",
  "image_gen:worker_down": "素材准备失败：处理服务未启动，请重启客户端",
  "image_gen:timeout": "素材准备超时，上游响应过慢，请稍后重试",
  "image_gen:unknown": "素材准备失败，请稍后重试",

  "image_upload:network": "图片上传卖家中心失败：网络异常，请检查网络后重试",
  "image_upload:auth": "图片上传失败：卖家中心登录状态已失效，请重新登录",
  "image_upload:timeout": "图片上传超时，请稍后重试",
  "image_upload:unknown": "图片上传卖家中心未完成，请稍后重试",

  "category:unknown": "类目暂未匹配成功，请补充更准确的类目信息后重试",

  "draft:network": "草稿保存失败：网络异常，请重试",
  "draft:auth": "草稿保存失败：登录状态已失效，请重新登录",
  "draft:unknown": "草稿保存未完成，请稍后重试",

  "unknown:network": "网络异常，请检查网络连接或代理设置",
  "unknown:auth": "登录状态已失效，请重新登录后再试",
  "unknown:quota": "额度不足或已触发限流，请稍后再试",
  "unknown:timeout": "请求超时，请稍后重试",
};

function normalizeBatchReason(messageText: string, errorCategory?: string) {
  const text = String(messageText || "").trim();
  if (!text) {
    if (errorCategory && ERROR_CATEGORY_HINTS[errorCategory]) return ERROR_CATEGORY_HINTS[errorCategory];
    if (errorCategory) {
      const stage = errorCategory.split(":")[0];
      const fallbackKey = `${stage}:unknown`;
      if (ERROR_CATEGORY_HINTS[fallbackKey]) return ERROR_CATEGORY_HINTS[fallbackKey];
    }
    return "请稍后重试";
  }

  // Worker 已经给出具体根因时，不再压成“草稿保存未完成”这类泛化提示。
  if (/草稿已创建|草稿箱只创建|SKU必填项|父规格|数量SKU|主图未达到|Temu 草稿内容保存失败|保存Temu草稿箱失败/i.test(text)) {
    return text;
  }

  // 只有非常明确的分类才覆盖原文；未知分类保留 Worker 原始信息，方便定位用户机器上的真实问题。
  if (errorCategory && ERROR_CATEGORY_HINTS[errorCategory] && !/unknown$/i.test(errorCategory)) {
    return ERROR_CATEGORY_HINTS[errorCategory];
  }

  // 旧正则兜底，保留向后兼容（老历史记录没有 errorCategory）
  if (/分类搜索失败/i.test(text)) return "类目暂未匹配成功，请补充更准确的类目信息后重试";
  if (/timeout|Execution context|page\.goto|worker|ipc/i.test(text)) return "页面响应较慢或连接中断，请重新尝试";
  if (/登录|authentication|seller-login/i.test(text)) return "登录状态已失效，请重新登录后再试";
  if (/quota|额度|403/i.test(text)) return "当前图片生成额度不足，请稍后再试";
  if (/图片|image|upload/i.test(text) && /失败|error/i.test(text)) return "图片处理未完成，请稍后重试";
  if (/草稿|draft/i.test(text) && /失败|error/i.test(text)) {
    return text === "草稿保存失败" ? "草稿保存失败：Temu 未返回具体原因，请重新登录后重试" : text;
  }

  return text;
}

function getResultFailureMeta(record: any) {
  const meta: string[] = [];
  if (record?.errorCode) meta.push(`错误码 ${record.errorCode}`);
  if (record?.draftStep) meta.push(`阶段 ${record.draftStep}`);
  if (record?.verificationReason) meta.push(`校验 ${record.verificationReason}`);
  if (record?.debugFile) meta.push(`调试文件 ${record.debugFile}`);
  return meta;
}

function getUserFacingTaskMessage(progressInfo: any, count: number) {
  const total = Number(progressInfo?.total || count || 0);
  const completed = Number(progressInfo?.completed || 0);
  const currentIndex = total > 0 ? Math.min(completed + 1, total) : 0;

  if (progressInfo?.status === "completed") return "本批商品已处理完成。";
  if (progressInfo?.status === "failed" || progressInfo?.status === "interrupted") {
    return normalizeBatchReason(progressInfo?.message || "本批商品已停止处理");
  }
  if (progressInfo?.status === "pausing") return "暂停请求已发送，当前商品处理完后会停下。";
  if (progressInfo?.status === "paused") return "当前批次已暂停，可随时继续。";
  if (progressInfo?.running || progressInfo?.status === "running") {
    return currentIndex > 0 && total > 0
      ? `正在处理第 ${currentIndex} / ${total} 个商品，请稍候。`
      : "正在准备当前批次，请稍候。";
  }
  return "选好表格后就可以开始批量生成商品草稿。";
}

type PreviewState = {
  headers: any[];
  rows: any[][];
  total: number;
  detected: Record<string, number>;
  validation: ValidationSummary;
} | null;

function getWorkflowStatusMeta(status: WorkflowStatus) {
  if (status === "success") return { color: "success", label: "已完成" };
  if (status === "running") return { color: "processing", label: "进行中" };
  if (status === "warning") return { color: "warning", label: "需处理" };
  if (status === "ready") return { color: "blue", label: "可执行" };
  return { color: "default", label: "待开始" };
}

function WorkflowPanel(props: {
  step: number;
  title: string;
  status: WorkflowStatus;
  summary: string;
  detail?: ReactNode;
  actions?: ReactNode;
  extra?: ReactNode;
}) {
  const { color, label } = getWorkflowStatusMeta(props.status);
  return (
    <Card style={{ borderRadius: 20, borderColor: "#eceff4" }} bodyStyle={{ padding: 20, height: "100%" }}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Space wrap>
            <Tag color={color}>{`步骤 ${props.step}`}</Tag>
            <Text strong>{props.title}</Text>
          </Space>
          <Tag color={color}>{label}</Tag>
        </div>
        <Text>{props.summary}</Text>
        {props.detail ? <div style={{ display: "grid", gap: 8 }}>{props.detail}</div> : null}
        {props.extra}
        {props.actions ? <Space wrap>{props.actions}</Space> : null}
      </Space>
    </Card>
  );
}

function buildValidationSummary(dataRows: any[][], detected: Record<string, number>) {
  const totalRows = Array.isArray(dataRows) ? dataRows.length : 0;
  const requiredHeadersMissing = [
    detected.mainImage >= 0 ? "" : "商品原图 / 商品主图",
    detected.backCategory >= 0 ? "" : "后台分类",
  ].filter(Boolean);
  const suggestedHeadersMissing = [
    detected.title >= 0 ? "" : "商品标题",
    detected.price >= 0 ? "" : "美元价格",
    detected.carousel >= 0 ? "" : "商品轮播图",
  ].filter(Boolean);

  const countMissing = (fieldIndex: number) => {
    if (fieldIndex < 0) return totalRows;
    return dataRows.reduce((count, row) => {
      const text = normalizeCellText(row?.[fieldIndex]);
      return text ? count : count + 1;
    }, 0);
  };

  const blockingIssues: ValidationIssue[] = [
    {
      key: "mainImage",
      label: "原图缺失",
      count: countMissing(detected.mainImage ?? -1),
      hint: "自动化上品需要可下载的商品原图，否则素材准备无法开始。",
    },
    {
      key: "backCategory",
      label: "后台分类缺失",
      count: countMissing(detected.backCategory ?? -1),
      hint: "当前自动化草稿链路以【后台分类】为硬约束，缺失时该商品会被跳过。",
    },
  ].filter((issue) => issue.count > 0);

  const warningIssues: ValidationIssue[] = [
    {
      key: "title",
      label: "标题缺失",
      count: countMissing(detected.title ?? -1),
      hint: "标题缺失会降低 AI 理解商品的准确度，建议补齐。",
    },
    {
      key: "price",
      label: "价格缺失",
      count: countMissing(detected.price ?? -1),
      hint: "价格缺失时会回退默认价格，建议在导表前补齐。",
    },
    {
      key: "carousel",
      label: "轮播图缺失",
      count: countMissing(detected.carousel ?? -1),
      hint: "轮播图不是硬阻塞，但补充后能让素材准备更稳。",
    },
  ].filter((issue) => issue.count > 0);

  return {
    totalRows,
    requiredHeadersMissing,
    suggestedHeadersMissing,
    blockingIssues,
    warningIssues,
    canProceed: requiredHeadersMissing.length === 0 && blockingIssues.length === 0,
  } satisfies ValidationSummary;
}

function BatchCreate() {
  const [mode, setMode] = useState<BatchCreateMode>(() => {
    try {
      const stored = window.localStorage.getItem(PRODUCT_CREATE_MODE_STORAGE_KEY);
      return stored === "workflow" ? "workflow" : "classic";
    } catch {
      return "classic";
    }
  });
  const [filePath, setFilePath] = useState("");
  const [preview, setPreview] = useState<PreviewState>(null);
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
  const [packGenerating, setPackGenerating] = useState(false);
  const [packResult, setPackResult] = useState<any>(null);
  const [reviewedTaskIds, setReviewedTaskIds] = useState<Record<string, true>>(() => {
    try {
      const raw = window.localStorage.getItem(PRODUCT_CREATE_REVIEW_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const progressRef = useRef<any>(null);
  const runningStateRef = useRef(false);
  const workflowStartInFlightRef = useRef(false);

  const stopPolling = () => {
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
  };

  const syncTaskHistory = (task: any) => {
    if (!task?.taskId) return;
    const normalizedTask = normalizeTaskForFlow(task, mode);
    setTaskHistory((prev) => [normalizedTask, ...prev.filter((item) => item?.taskId !== normalizedTask.taskId)].slice(0, 10));
  };

  const applyTaskSnapshot = (task: any) => {
    if (!task) return;
    const normalizedTask = normalizeTaskForFlow(task, mode);
    if (normalizedTask.taskId) setSelectedTaskId(normalizedTask.taskId);
    setProgressInfo(normalizedTask);
    setResults(Array.isArray(normalizedTask.results) ? normalizedTask.results : []);
    setPaused(Boolean(normalizedTask.paused));
    setRunning(Boolean(normalizedTask.running));
    if (normalizedTask.csvPath) setFilePath(normalizedTask.csvPath);
    if (typeof normalizedTask.startRow === "number") setStartRow(normalizedTask.startRow);
    if (typeof normalizedTask.count === "number" && normalizedTask.count > 0) setCount(normalizedTask.count);
  };

  const refreshTaskHistory = async (preserveSelection = true) => {
    try {
      setHistoryLoading(true);
      const tasks = await api?.listTasks?.();
      if (!Array.isArray(tasks)) return;

      const normalizedTasks = tasks.map((task: any) => normalizeTaskForFlow(task, getTaskFlowType(task)));
      setTaskHistory(normalizedTasks);
      const modeTasks = normalizedTasks.filter((task: any) => getTaskFlowType(task) === mode);
      if (modeTasks.length === 0) return;

      const preferredTask = preserveSelection
        ? modeTasks.find((task: any) => task?.taskId === selectedTaskId) || modeTasks[0]
        : modeTasks[0];

      if (!preferredTask) return;
      applyTaskSnapshot(preferredTask);
      if (preferredTask.running) {
        pollProgress(preferredTask.taskId, true);
      }
    } catch (error) {
      // 任务历史加载失败降级为空列表，不阻塞创建流程
      console.warn("[ProductCreate] refreshTaskHistory failed", error);
    } finally {
      setHistoryLoading(false);
    }
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
          message.success(`批量创建完成：成功 ${successItems} 个，失败 ${failItems} 个`);
        } else {
          message.error(normalizeBatchReason(snapshot.message || "本批商品未完成处理"));
        }
      } catch (error) {
        // 轮询某次拉取失败不要中断定时器，下一次 tick 自然重试
        console.warn("[ProductCreate] pollProgress tick failed", error);
      }
    }, 2200);
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
      message.success("已恢复这批商品的处理记录");
    } catch (error: any) {
      message.error(error?.message || "恢复记录失败");
    }
  };

  const loadPreview = async (nextFilePath: string) => {
    try {
      const data = await api?.readScrapeData?.(`csv_preview:${nextFilePath}`);
      if (!data?.rows || data.rows.length === 0) {
        setPreview(null);
        message.info(mode === "workflow" ? "文件已载入，可以开始新上品流程" : "文件已载入，可以直接开始批量创建");
        return;
      }

      let headerRowIdx = 0;
      const columnMap: Record<string, string[]> = {
        title: ["商品标题（中文）", "商品名称", "title"],
        mainImage: ["商品主图", "商品原图"],
        carousel: ["商品轮播图"],
        backCategory: ["后台分类"],
        frontCategory: ["前台分类（中文）"],
        category: ["分类（中文）", "分类关键词", "category", "分类"],
        price: ["美元价格($)", "美元价格", "price"],
        leafCategoryId: ["leafCatId", "leafCategoryId", "catId", "categoryId", "叶子类目ID"],
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
      const validation = buildValidationSummary(dataRows, detected);
      setPreview({
        headers,
        rows: dataRows.slice(0, 5),
        total: dataRows.length,
        detected,
        validation,
      });
      setCount(Math.min(dataRows.length || 1, 10));
      message.success(`已识别 ${dataRows.length} 个商品`);
    } catch {
      setPreview(null);
      message.info(mode === "workflow" ? "文件已载入，可以开始新上品流程" : "文件已载入，可以直接开始批量创建");
    }
  };

  const resetSheetState = () => {
    stopPolling();
    setFilePath("");
    setPreview(null);
    setResults([]);
    setFilterSummary(null);
    setPackResult(null);
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
    setPackResult(null);
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
    setPackResult(null);
    await loadPreview(nextFilePath);
    return false;
  };

  const hydrateTaskState = async () => {
    try {
      const tasks = await api?.listTasks?.();
      if (Array.isArray(tasks) && tasks.length > 0) {
        const normalizedTasks = tasks.map((task: any) => normalizeTaskForFlow(task, getTaskFlowType(task)));
        setTaskHistory(normalizedTasks);
        const modeTasks = normalizedTasks.filter((task: any) => getTaskFlowType(task) === mode);
        const preferredTask = modeTasks.find((task: any) => task?.running) || modeTasks[0];
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
    } catch (error) {
      // 恢复任务视图失败时静默退出，不自动重试以免扰乱用户
      console.warn("[ProductCreate] restoreTaskView failed", error);
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
        message.success(paused ? "当前批次已继续处理" : "暂停请求已发送，当前商品处理完后会停下");
      } else {
        stopPolling();
        message.success("当前批次已暂停");
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
      setPackResult(null);
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
      flowType: "classic",
      total: count,
      completed: 0,
      current: "准备中",
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
        message.warning(response?.message || "当前已有批量创建任务在运行");
        return;
      }

      if (response?.task) {
        applyTaskSnapshot(response.task);
        syncTaskHistory(response.task);
      }
      message.success("批量创建已开始");
      void refreshTaskHistory(false);
      pollProgress(response?.task?.taskId);
    } catch (error: any) {
      setRunning(false);
      setPaused(false);
      message.error(error?.message || "启动批量创建失败");
    }
  };

  const handleWorkflowTest = () => {
    if (!filePath) {
      message.warning("请先上传商品表格");
      return;
    }
    message.info("新上品流程会沿用批量上品入口，后台自动准备素材并回写数据。");
  };

  const handleWorkflowPackImages = async () => {
    if (!filePath) {
      message.warning("请先上传商品表格");
      return;
    }
    if (workflowStartInFlightRef.current || packGenerating || running) {
      message.warning("已有新上品流程正在执行，请勿重复启动。");
      return;
    }
    workflowStartInFlightRef.current = true;
    setPackGenerating(true);
    setRunning(true);
    setPaused(false);
    setPackResult(null);
    setResults([]);
    const taskId = `workflow_pack_${Date.now()}`;
    setSelectedTaskId(taskId);
    setProgressInfo({
      taskId,
      running: true,
      status: "running",
      flowType: "workflow",
      step: "新上品流程",
      current: "后台正在准备素材、上传素材中心并保存草稿",
      message: `正在处理 ${count} 个商品`,
      total: count,
      completed: 0,
    });
    syncTaskHistory({
      taskId,
      running: true,
      status: "running",
      flowType: "workflow",
      total: count,
      completed: 0,
      csvPath: filePath,
      startRow,
      count,
      current: "后台正在准备素材、上传素材中心并保存草稿",
      step: "新上品流程",
      results: [],
    });
    pollProgress(taskId, true);

    const buildWorkflowRows = (response: any) => {
      const responseRows = Array.isArray(response?.results) ? response.results : [];
      return responseRows.map((item: any, index: number) => {
        const rowIndex = typeof item?.rowNumber === "number"
          ? Math.max(item.rowNumber - 1, 0)
          : startRow + index;
        const isComplete = item?.success === true;
        const isPartial = !isComplete && Number(item?.successCount || 0) > 0;
        const messageText = isComplete
          ? (item?.message || "商品已保存到 Temu 草稿箱")
          : isPartial
            ? (item?.message || "部分商品已处理，请检查结果")
            : (item?.message || item?.error || "新上品流程处理失败");

        return {
          ...item,
          index: rowIndex,
          name: item?.name || item?.productName || item?.title,
          success: isComplete,
          message: messageText,
          workflowStage: "draft_create",
          kwcdnTablePath: response?.kwcdnTablePath,
        };
      });
    };

    let preserveRunningState = false;
    try {
      const response = await api?.generatePackImages?.({
        taskId,
        csvPath: filePath,
        startRow,
        count,
        packCounts: [2, 3, 4],
        quantityCounts: [1, 2, 3, 4],
        workflowRandomSpecValueCount: 2,
        workflowQuantityPriceMultipliers: { 1: 4, 2: 3, 3: 2.5, 4: 2 },
        createDrafts: true,
      });
      if (response?.accepted === false) {
        if (response.task) {
          preserveRunningState = Boolean(response.task?.running || ["running", "pausing", "paused"].includes(response.task?.status));
          applyTaskSnapshot(response.task);
          syncTaskHistory(response.task);
        }
        message.warning(response.message || "已有新上品流程正在执行，请勿重复启动。");
        return;
      }
      const workflowRows = buildWorkflowRows(response);
      const workflowTask = response?.task || (response?.taskId ? {
        taskId: response.taskId,
        flowType: "workflow",
        status: response?.success === false ? "failed" : "completed",
        running: false,
        paused: false,
        csvPath: filePath,
        startRow,
        count,
        total: Number(response?.total || response?.totalCount || count || workflowRows.length || 0),
        completed: workflowRows.length,
        current: response?.success === false ? "处理未完成" : "已完成",
        step: "新上品流程",
        message: response?.message || "",
        results: workflowRows,
      } : null);
      if (workflowTask) {
        syncTaskHistory({ ...workflowTask, flowType: "workflow", results: workflowRows });
        setSelectedTaskId(workflowTask.taskId || "");
      }
      const processedCount = workflowRows.length
        || Number(response?.successCount || 0) + Number(response?.partialCount || 0) + Number(response?.failCount || 0);
      const totalCount = Number(response?.total || response?.totalCount || count || workflowRows.length || 0);

      setResults(workflowRows);
      if (!response?.success) {
        setPackResult(response || null);
        setProgressInfo({
          taskId,
          running: false,
          status: "failed",
          step: "新上品流程",
          flowType: "workflow",
          current: "处理未完成",
          message: response?.message || "新上品流程未完成",
          total: totalCount,
          completed: processedCount,
          results: workflowRows,
        });
        message.error(response?.message || "新上品流程未完成");
        return;
      }
      setPackResult(response);
      const ok = response.successCount || 0;
      const partial = response.partialCount || 0;
      setProgressInfo({
        taskId,
        running: false,
        status: "completed",
        step: "新上品流程",
        flowType: "workflow",
        current: "已完成",
        message: `新上品流程完成：完整 ${ok} 个，部分 ${partial} 个`,
        total: totalCount,
        completed: processedCount || totalCount,
        results: workflowRows,
      });
      message.success(`新上品流程完成：完整 ${ok} 个，部分 ${partial} 个`);
    } catch (error: any) {
      if (error?.task) {
        preserveRunningState = Boolean(error.task?.running || ["running", "pausing", "paused"].includes(error.task?.status));
        applyTaskSnapshot(error.task);
        syncTaskHistory(error.task);
      }
      setProgressInfo({
        taskId,
        running: false,
        status: "failed",
        flowType: "workflow",
        step: "新上品流程",
        current: "处理失败",
        message: error?.message || "新上品流程启动失败",
        total: count,
        completed: 0,
      });
      message.error(error?.message || "新上品流程启动失败");
    } finally {
      workflowStartInFlightRef.current = false;
      setPackGenerating(false);
      if (!preserveRunningState) setRunning(false);
    }
  };

  const toggleReviewed = () => {
    const taskId = selectedTaskId || progressInfo?.taskId;
    if (!taskId) {
      message.warning("当前还没有可检查的素材任务");
      return;
    }
    setReviewedTaskIds((prev) => {
      if (prev[taskId]) {
        const next = { ...prev };
        delete next[taskId];
        message.success("已取消这批素材的检查标记");
        return next;
      }
      message.success("已标记这批素材完成人工检查");
      return { ...prev, [taskId]: true };
    });
  };

  useEffect(() => {
    runningStateRef.current = running;
  }, [running]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PRODUCT_CREATE_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore local storage write failures in desktop sandbox edge cases
    }
    setSelectedTaskId("");
    setResults([]);
    setPackResult(null);
    setProgressInfo({ running: false, status: "idle" });
    setPaused(false);
    setRunning(false);
    setPackGenerating(false);
    stopPolling();
  }, [mode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PRODUCT_CREATE_REVIEW_STORAGE_KEY, JSON.stringify(reviewedTaskIds));
    } catch {
      // ignore local storage write failures in desktop sandbox edge cases
    }
  }, [reviewedTaskIds]);

  useEffect(() => {
    void hydrateTaskState();
  }, []);

  useEffect(() => () => {
    stopPolling();
  }, []);

  const hasFile = Boolean(filePath);
  const hasPreview = Boolean(preview?.rows?.length);
  const hasResults = results.length > 0;
  const hasPackResults = Boolean(packResult?.results?.length);
  const packCompleteCount = packResult?.successCount || 0;
  const packPartialCount = packResult?.partialCount || 0;
  const packFailCount = packResult?.failCount || 0;
  const pausePending = progressInfo?.status === "pausing";
  const workflowTaskActive = packGenerating || running || paused || pausePending;
  const hasTaskProgress = Boolean(
    running
    || paused
    || progressInfo?.taskId
    || progressInfo?.completed
    || ["completed", "failed", "interrupted", "running", "pausing", "paused"].includes(progressInfo?.status),
  );
  const batchStatusLabel = getBatchStatusLabel(progressInfo?.status, running, paused);
  const batchTagColor = getBatchTagColor(progressInfo?.status, running, paused);
  const batchStatusMessage = getUserFacingTaskMessage(progressInfo, count);
  const currentFileName = filePath ? filePath.split(/[/\\]/).pop() : "未选择文件";
  const successCount = results.filter((item: any) => item.success).length;
  const failCount = results.filter((item: any) => !item.success).length;
  const currentTaskId = selectedTaskId || progressInfo?.taskId || "";
  const currentTaskReviewed = Boolean(currentTaskId && reviewedTaskIds[currentTaskId]);
  const progressTotal = progressInfo?.total || count || 0;
  const progressPercent = progressTotal > 0 ? Math.round(((progressInfo?.completed || 0) / progressTotal) * 100) : 0;
  const completedCount = progressInfo?.completed || 0;
  const pendingCount = Math.max(progressTotal - completedCount, 0);
  const previewData = preview;
  const validation = previewData?.validation || null;
  const validationBlockingCount = validation?.blockingIssues.reduce((sum, item) => sum + item.count, 0) || 0;
  const validationWarningCount = validation?.warningIssues.reduce((sum, item) => sum + item.count, 0) || 0;
  const currentTaskStatusText = String(progressInfo?.message || progressInfo?.current || progressInfo?.step || batchStatusMessage || "-");
  const progressUpdatedAtText = String(progressInfo?.updatedAt || progressInfo?.startedAt || "");
  const aiStageActive = Boolean(running && /(下载原图|AI生图|上传图片|生成标题)/.test(progressInfo?.step || ""));
  const draftStageActive = Boolean(running && /(保存草稿|草稿保存|开始处理|执行失败)/.test(progressInfo?.step || ""));
  const aiStageFailed = results.some((item: any) => !item.success && /^image_gen:|^image_upload:|^source_download:/.test(String(item?.errorCategory || "")));
  const draftStageFailed = results.some((item: any) => !item.success && /^draft:|^category:|^unknown:/.test(String(item?.errorCategory || "")));
  const importStepStatus: WorkflowStatus = hasFile ? "success" : "pending";
  const validationStepStatus: WorkflowStatus = !hasFile
    ? "pending"
    : validation?.canProceed
      ? "success"
      : "warning";
  const filterStepStatus: WorkflowStatus = !hasFile
    ? "pending"
    : filterSummary
      ? "success"
      : validation?.canProceed
        ? "ready"
        : "pending";
  const aiStepStatus: WorkflowStatus = !hasFile
    ? "pending"
    : packGenerating || aiStageActive
      ? "running"
      : hasPackResults
        ? (packFailCount > 0 || packPartialCount > 0 ? "warning" : "success")
        : packResult && !packResult.success
          ? "warning"
          : hasResults
        ? (aiStageFailed ? "warning" : "success")
        : (validation?.canProceed ? "ready" : "pending");
  const draftStepStatus: WorkflowStatus = !hasFile
    ? "pending"
    : draftStageActive
      ? "running"
      : hasResults
        ? (failCount > 0 || draftStageFailed ? "warning" : "success")
        : (validation?.canProceed ? "ready" : "pending");
  const reviewStepStatus: WorkflowStatus = !hasResults
    ? "pending"
    : currentTaskReviewed
      ? "success"
      : "ready";
  const workflowOverviewSteps = [
    { step: 1, title: "导表", status: importStepStatus },
    { step: 2, title: "读取商品原图", status: validationStepStatus },
    { step: 3, title: "后台处理", status: aiStepStatus },
  ];

  const previewRows = hasPreview && previewData
    ? previewData.rows.map((row: any[], index: number) => {
      const detected = previewData.detected || {};
      const titleText = detected.title >= 0 ? normalizeCellText(row[detected.title]) : "";
      const carouselText = detected.carousel >= 0 ? normalizeCellText(row[detected.carousel]) : "";
      const categoryText = detected.backCategory >= 0
        ? normalizeCategoryCellText(row[detected.backCategory])
        : detected.category >= 0
          ? normalizeCategoryCellText(row[detected.category])
          : detected.frontCategory >= 0
            ? normalizeCategoryCellText(row[detected.frontCategory])
            : detected.leafCategoryId >= 0
              ? normalizeCellText(row[detected.leafCategoryId])
              : "";
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

  const visibleTaskHistory = taskHistory.filter((task) => getTaskFlowType(task) === mode).slice(0, 3);
  const resultRows = results
    .map((item: any, index: number) => ({
      key: `${item?.index ?? index}-${getResultSuccessIdentity(item) || item?.message || ""}`,
      ...item,
      displayName: getResultDisplayName(item, index),
      rowMeta: getResultRowMeta(item, index),
    }))
    .sort((left: any, right: any) => Number(left.success) - Number(right.success));

  const normalizedFailedReasonSummary = Object.entries(
    results.reduce<Record<string, number>>((acc, item: any) => {
      if (item?.success) return acc;
      const reason = normalizeBatchReason(item?.message || "请稍后重试", item?.errorCategory);
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);

  const resultColumns: ColumnsType<any> = [
    {
      title: "商品",
      dataIndex: "displayName",
      key: "displayName",
      ellipsis: true,
      render: (value: string, record: any) => (
        <div>
          <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{value}</div>
          <div style={{ fontSize: 13, color: "var(--color-text-sec)", marginTop: 4 }}>{record.rowMeta}</div>
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
      title: "说明",
      dataIndex: "message",
      key: "message",
      ellipsis: true,
      render: (value: string, record: any) => record.success
        ? <span style={{ color: SUCCESS_COLOR }}>{getResultSuccessDetail(record)}</span>
        : (() => {
          const reason = normalizeBatchReason(value || "请稍后重试", record?.errorCategory);
          const meta = getResultFailureMeta(record);
          const title = [reason, ...meta].filter(Boolean).join("\n");
          return (
            <div title={title || undefined}>
              <span style={{ color: "#ff4d4f" }}>{reason}</span>
              {meta.length > 0 ? (
                <div style={{ fontSize: 12, color: "var(--color-text-sec)", marginTop: 4, lineHeight: 1.5 }}>
                  {meta.join(" · ")}
                </div>
              ) : null}
            </div>
          );
        })(),
    },
  ];

  const getWorkflowMaterialImageLabel = (image: any) => {
    if (image?.label) return String(image.label);
    if (image?.role === "original" || image?.imageType === "original") return "原图";
    if (image?.packCount) return `${image.packCount}PCS`;
    return String(image?.imageType || "素材");
  };
  const getWorkflowMaterialImageTagColor = (image: any) => {
    if (image?.skipped) return "warning";
    return image?.imageUrl ? "blue" : "error";
  };
  const renderWorkflowMaterialUploadStatus = (image: any) => {
    if (image?.kwcdnUrl) return <Tag color="success">已上传</Tag>;
    if (image?.uploadError) return <Tag color="error">上传失败</Tag>;
    if (image?.skipped || image?.uploadEligible === false) return <Tag color="warning">不上传</Tag>;
    return null;
  };
  const renderWorkflowKwcdnUrl = (image: any) => {
    if (!image?.kwcdnUrl) return null;
    const url = String(image.kwcdnUrl);
    return (
      <Typography.Paragraph
        copyable={{ text: url }}
        ellipsis={{ rows: 1, tooltip: url }}
        style={{ margin: "6px 0 0", fontSize: 12 }}
      >
        {url}
      </Typography.Paragraph>
    );
  };

  const modeHint = mode === "classic"
    ? "保留你之前一直在用的 AI 生图上品流程：导表后直接走 AI 生图、图片上传和草稿生成。"
    : "新上品流程会沿用批量上品入口，后台自动准备素材、上传素材中心并回写 kwcdn 数据。";

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card style={{ borderRadius: 22, borderColor: "#eceff4" }} bodyStyle={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text className="create-flow-toolbar__eyebrow">上品流程模式</Text>
            <Title level={4} style={{ margin: "4px 0 0" }}>
              {mode === "classic" ? "AI 生图上品流程" : "新上品流程"}
            </Title>
            <Text type="secondary" className="create-flow-toolbar__desc">
              {modeHint}
            </Text>
          </div>
          <Segmented<BatchCreateMode>
            value={mode}
            onChange={(value) => setMode(value as BatchCreateMode)}
            options={[
              { label: "AI 生图上品流程", value: "classic" },
              { label: "新上品流程", value: "workflow" },
            ]}
          />
        </div>
      </Card>

      {mode === "classic" ? (
        <div className="create-flow-toolbar">
          <div className="create-flow-toolbar__summary">
            <Text className="create-flow-toolbar__eyebrow">批量创建</Text>
            <Title level={4} style={{ margin: 0 }}>AI 生图上品流程</Title>
            <Text type="secondary" className="create-flow-toolbar__desc">
              这是你原来的老流程。导入 Excel 或 CSV 后，可选过滤高风险商品，然后直接走 AI 生图、图片上传和 Temu 草稿生成。
            </Text>
            <Space wrap className="app-table-meta">
              <Tag color={batchTagColor}>{batchStatusLabel}</Tag>
              {hasFile ? <Tag>{currentFileName}</Tag> : <Tag>还没有选择文件</Tag>}
              {hasFile ? <Tag>{`从第 ${startRow + 1} 行开始`}</Tag> : null}
              {preview?.total ? <Tag color="blue">{`共 ${preview.total} 个商品`}</Tag> : null}
              {hasFile ? <Tag>{`本次处理 ${count} 个`}</Tag> : null}
            </Space>
          </div>

          <div className="create-flow-toolbar__controls">
            <div className="create-flow-toolbar__inputs">
              <div className="create-flow-toolbar__input">
                <span className="create-flow-toolbar__label">起始行</span>
                <InputNumber min={0} value={startRow} onChange={(value) => setStartRow(value || 0)} style={{ width: "100%" }} />
              </div>
              <div className="create-flow-toolbar__input">
                <span className="create-flow-toolbar__label">处理数量</span>
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
                刷新记录
              </Button>
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                disabled={!hasFile || running}
                loading={running && !paused}
                onClick={handleBatch}
                className="create-primary-button"
              >
                {running ? "处理中..." : `开始批量创建（${count} 个）`}
              </Button>
              {running ? (
                <Button
                  icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                  onClick={togglePause}
                  className="create-secondary-button"
                  disabled={pausePending}
                >
                  {pausePending ? "暂停中..." : paused ? "继续处理" : "暂停处理"}
                </Button>
              ) : null}
              {hasFile ? <Button onClick={resetSheetState}>清空文件</Button> : null}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <Card style={{ borderRadius: 18, borderColor: "#eef2f6" }} bodyStyle={{ padding: 20 }}>
            <div style={{ display: "grid", gap: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text className="create-flow-toolbar__eyebrow">新上品流程</Text>
                  <Title level={4} style={{ margin: "4px 0 0" }}>批量创建</Title>
                  <Text type="secondary" className="create-flow-toolbar__desc">
                    导入 Excel 或 CSV 后，可先过滤高风险商品，然后按新流程批量处理。
                  </Text>
                </div>
                <Space wrap className="app-table-meta">
                  <Tag color={batchTagColor}>{batchStatusLabel}</Tag>
                  {hasFile ? <Tag>{currentFileName}</Tag> : <Tag>待上传商品表</Tag>}
                  {hasFile ? <Tag>{`从第 ${startRow + 1} 行开始`}</Tag> : null}
                  {preview?.total ? <Tag color="blue">{`共 ${preview.total} 个商品`}</Tag> : null}
                </Space>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <div>
                  <div className="create-flow-toolbar__label">起始行</div>
                  <InputNumber min={0} value={startRow} onChange={(value) => setStartRow(value || 0)} style={{ width: "100%" }} />
                </div>
                <div>
                  <div className="create-flow-toolbar__label">处理数量</div>
                  <InputNumber min={1} max={100} value={count} onChange={(value) => setCount(value || 1)} style={{ width: "100%" }} />
                </div>
              </div>

              {validation && !validation.canProceed ? (
                <Alert
                  type="warning"
                  showIcon
                  message={`表格有 ${validationBlockingCount} 条需要注意`}
                  description={validation.requiredHeadersMissing.length > 0 ? `缺少必需列：${validation.requiredHeadersMissing.join("、")}` : "可以继续处理当前选择范围；缺少关键字段的商品会在结果里标记失败。"}
                />
              ) : null}
              {packResult?.message && !hasPackResults ? (
                <Alert type="warning" showIcon message={packResult.message} />
              ) : null}

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
                  {filterSummary ? "重新筛选" : "过滤高风险"}
                </Button>
                <Button icon={<HistoryOutlined />} loading={historyLoading} onClick={() => void refreshTaskHistory()}>
                  刷新记录
                </Button>
                <Button
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  disabled={!hasFile || packGenerating || running}
                  loading={packGenerating}
                  onClick={handleWorkflowPackImages}
                  className="create-primary-button"
                >
                  {packGenerating ? "处理中..." : `开始批量创建（${count} 个）`}
                </Button>
                {workflowTaskActive ? (
                  <Button
                    icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                    onClick={togglePause}
                    className="create-secondary-button"
                    disabled={pausePending}
                  >
                    {pausePending ? "暂停中..." : paused ? "继续处理" : "暂停处理"}
                  </Button>
                ) : null}
                {hasFile ? <Button onClick={resetSheetState}>清空文件</Button> : null}
              </div>
            </div>
          </Card>

          <div style={{ display: "none" }}>
            <StatCard compact title="当前状态" value={batchStatusLabel} color={running ? "brand" : paused ? "purple" : "neutral"} />
            <StatCard compact title="商品表" value={hasFile ? currentFileName : "待上传"} color={hasFile ? "success" : "neutral"} />
            <StatCard compact title="总商品数" value={preview?.total || 0} color="blue" />
            <StatCard compact title="人工复核" value={currentTaskReviewed ? "已标记" : hasResults ? "待复核" : "未开始"} color={currentTaskReviewed ? "success" : hasResults ? "danger" : "neutral"} />
          </div>

          <div style={{ display: "none" }}>
            {workflowOverviewSteps.map((item) => {
              const meta = getWorkflowStatusMeta(item.status);
              return (
                <Card key={item.step} style={{ borderRadius: 18, borderColor: "#eef2f6" }} bodyStyle={{ padding: 16 }}>
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Text type="secondary">{`步骤 ${item.step}`}</Text>
                    <Text strong>{item.title}</Text>
                    <Tag color={meta.color}>{meta.label}</Tag>
                  </Space>
                </Card>
              );
            })}
          </div>

          <div style={{ display: "none" }}>
            <WorkflowPanel
              step={1}
              title="导表"
              status={importStepStatus}
              summary={hasFile ? `当前文件：${currentFileName}` : "先上传 Excel / CSV，系统会自动识别字段并准备预览。"}
              detail={hasFile ? (
                <Space wrap className="app-table-meta">
                  <Tag color="blue">{`共 ${preview?.total || 0} 条商品`}</Tag>
                  <Tag>{`从第 ${startRow + 1} 行开始`}</Tag>
                  <Tag>{`本次处理 ${count} 条`}</Tag>
                </Space>
              ) : (
                <Text type="secondary">支持 Excel / CSV。上传后会自动生成前 5 行预览。</Text>
              )}
              actions={(
                <>
                  <Button icon={<FileExcelOutlined />} onClick={() => void selectFile()}>
                    {hasFile ? "更换文件" : "选择文件"}
                  </Button>
                  {hasFile ? (
                    <Button icon={<ReloadOutlined />} onClick={() => void loadPreview(filePath)}>
                      重新识别
                    </Button>
                  ) : null}
                </>
              )}
            />

            <WorkflowPanel
              step={2}
              title="字段校验"
              status={validationStepStatus}
              summary={!hasFile
                ? "上传表格后自动校验关键字段，先找出会阻塞上品的列和空值。"
                : validation?.canProceed
                  ? `字段校验已通过${validationWarningCount > 0 ? `，还有 ${validationWarningCount} 条建议优化项` : ""}。`
                  : `当前有 ${validationBlockingCount} 条阻塞项，需要先处理后再继续。`}
              detail={validation ? (
                <>
                  {validation.requiredHeadersMissing.length > 0 ? (
                    <Alert
                      type="error"
                      showIcon
                      message={`缺少必需列：${validation.requiredHeadersMissing.join("、")}`}
                    />
                  ) : null}
                  {validation.blockingIssues.map((issue) => (
                    <div key={issue.key} style={{ display: "grid", gap: 4 }}>
                      <Text strong>{`${issue.label}：${issue.count} / ${validation.totalRows}`}</Text>
                      <Text type="secondary">{issue.hint}</Text>
                    </div>
                  ))}
                  {validation.warningIssues.slice(0, 2).map((issue) => (
                    <div key={issue.key} style={{ display: "grid", gap: 4 }}>
                      <Text strong>{`${issue.label}：${issue.count} / ${validation.totalRows}`}</Text>
                      <Text type="secondary">{issue.hint}</Text>
                    </div>
                  ))}
                  {validation.suggestedHeadersMissing.length > 0 ? (
                    <Text type="secondary">{`建议补充列：${validation.suggestedHeadersMissing.join("、")}`}</Text>
                  ) : null}
                </>
              ) : (
                <Text type="secondary">没有文件时不会触发字段校验。</Text>
              )}
              actions={hasFile ? (
                <Button icon={<ReloadOutlined />} onClick={() => void loadPreview(filePath)}>
                  重新校验
                </Button>
              ) : null}
            />

            <WorkflowPanel
              step={3}
              title="核价筛选"
              status={filterStepStatus}
              summary={!hasFile
                ? "字段准备好之后，可以先筛掉高风险商品再进入后续流程。"
                : filterSummary
                  ? `已保留 ${filterSummary.keptRows || 0} 条，排除 ${filterSummary.excludedRows || 0} 条高风险商品。`
                  : "这一步仍然保留为可选项，但建议在批量上品前先做一次筛表。"}
              detail={filterSummary ? (
                <Space wrap>
                  <Tag color="blue">液体 {filterSummary.excludedSummary?.liquid || 0}</Tag>
                  <Tag color="purple">膏体 {filterSummary.excludedSummary?.paste || 0}</Tag>
                  <Tag color="orange">带电 {filterSummary.excludedSummary?.electric || 0}</Tag>
                  <Tag color="cyan">服饰鞋 {filterSummary.excludedSummary?.clothing || 0}</Tag>
                  <Tag color="red">IP {filterSummary.excludedSummary?.ip || 0}</Tag>
                </Space>
              ) : (
                <Text type="secondary">如果这批商品来源比较杂，先筛表能减少后面素材准备的无效消耗。</Text>
              )}
              actions={(
                <Button icon={<FileExcelOutlined />} disabled={!hasFile} loading={filteringTable} onClick={handleFilterProductTable}>
                  {filterSummary ? "重新筛选" : "过滤高风险"}
                </Button>
              )}
            />

            <WorkflowPanel
              step={4}
              title="素材准备"
              status={aiStepStatus}
              summary={!hasFile
                ? "导表后，这一步会自动准备后续上品需要的商品素材。"
                : packGenerating
                  ? "正在按商品顺序准备上品素材。"
                  : hasPackResults
                    ? "后台素材已经准备完成，并已回写可用数据。"
                    : packResult && !packResult.success
                      ? "素材准备失败，请先看失败原因。"
                      : aiStageActive
                        ? (currentTaskStatusText || "正在逐商品准备上品素材。")
                        : hasResults
                          ? (aiStageFailed ? "本批次里有商品卡在素材准备阶段，建议先看失败原因。" : "这批商品的素材准备阶段已经跑完。")
                          : "点击下方按钮开始新上品流程。"}
              detail={(
                <>
                  <Text type="secondary">系统会按商品顺序准备上品所需素材，上传素材中心，并回写 kwcdn URL。</Text>
                  <Text type="secondary">这些步骤属于后台流程，不需要用户单独操作。</Text>
                  {packResult?.message && !hasPackResults ? (
                    <Alert type="warning" showIcon message={packResult.message} />
                  ) : null}
                  {hasPackResults ? (
                    <div style={{ display: "grid", gap: 12, marginTop: 4 }}>
                      <Space wrap>
                        <Tag color="success">{`完整 ${packCompleteCount}`}</Tag>
                        <Tag color={packPartialCount > 0 ? "warning" : "blue"}>{`部分 ${packPartialCount}`}</Tag>
                        <Tag color={packFailCount > 0 ? "error" : "default"}>{`失败 ${packFailCount}`}</Tag>
                        {packResult?.outputDir ? <Tag>{packResult.outputDir}</Tag> : null}
                        {packResult?.kwcdnTablePath ? <Tag>{`回写表 ${packResult.kwcdnTablePath}`}</Tag> : null}
                      </Space>
                      {packResult.results.map((item: any, itemIndex: number) => (
                        <div key={`${item.rowNumber || itemIndex}-${item.name}`} style={{ border: "1px solid #eef1f6", borderRadius: 8, padding: 12 }}>
                          <Space direction="vertical" size={8} style={{ width: "100%" }}>
                            <Space wrap>
                              <Text strong>{item.name || `商品 ${itemIndex + 1}`}</Text>
                              <Tag>{`表格行 ${item.rowNumber || item.index + 1}`}</Tag>
                              <Tag color={item.success ? "success" : item.successCount > 0 ? "warning" : "error"}>
                                {item.message || (item.success ? "素材已准备" : "素材准备失败")}
                              </Tag>
                            </Space>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 12 }}>
                              {(item.images || []).map((image: any) => (
                                <div key={image.imageType} style={{ border: "1px solid #edf0f5", borderRadius: 8, padding: 8, background: "#fff" }}>
                                  <Tag color={getWorkflowMaterialImageTagColor(image)}>{getWorkflowMaterialImageLabel(image)}</Tag>
                                  {renderWorkflowMaterialUploadStatus(image)}
                                  {image.imageUrl ? (
                                    <>
                                      <img
                                        src={image.imageUrl}
                                        alt={getWorkflowMaterialImageLabel(image)}
                                        style={{ display: "block", width: "100%", aspectRatio: "1 / 1", objectFit: "contain", marginTop: 8, background: "#fff" }}
                                      />
                                      {renderWorkflowKwcdnUrl(image)}
                                      {image.uploadError ? (
                                        <Text type="danger" style={{ display: "block", marginTop: 6 }}>{image.uploadError}</Text>
                                      ) : null}
                                    </>
                                  ) : (
                                    <Text type={image.skipped ? "warning" : "danger"} style={{ display: "block", marginTop: 8 }}>{image.error || (image.skipped ? "已按规则跳过" : "未生成")}</Text>
                                  )}
                                </div>
                              ))}
                            </div>
                          </Space>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {hasResults ? (
                    <Space wrap>
                      <Tag color="success">{`成功 ${successCount}`}</Tag>
                      <Tag color={aiStageFailed ? "error" : "blue"}>{`需关注 ${failCount}`}</Tag>
                    </Space>
                  ) : null}
                </>
              )}
              actions={(
                <>
                  <Button
                    type="primary"
                    icon={<CloudUploadOutlined />}
                    disabled={!hasFile}
                    loading={packGenerating}
                    onClick={handleWorkflowPackImages}
                    className="create-primary-button"
                  >
                    开始新上品流程
                  </Button>
                  <Button icon={<HistoryOutlined />} loading={historyLoading} onClick={() => void refreshTaskHistory()}>
                    刷新任务
                  </Button>
                </>
              )}
            />

            <WorkflowPanel
              step={5}
              title="流程结果"
              status={draftStepStatus}
              summary={running
                ? batchStatusMessage
                : hasResults
                  ? `当前批次已产出 ${successCount} 条成功草稿，${failCount} 条待处理。`
                  : "这里用于查看本次批量处理范围与结果状态。"}
              detail={(
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                    <div>
                      <div className="create-flow-toolbar__label">起始行</div>
                      <InputNumber min={0} value={startRow} onChange={(value) => setStartRow(value || 0)} style={{ width: "100%" }} />
                    </div>
                    <div>
                      <div className="create-flow-toolbar__label">处理数量</div>
                      <InputNumber min={1} max={100} value={count} onChange={(value) => setCount(value || 1)} style={{ width: "100%" }} />
                    </div>
                  </div>
                  <Space wrap className="app-table-meta">
                    <Tag color={batchTagColor}>{batchStatusLabel}</Tag>
                    {hasFile ? <Tag>{`从第 ${startRow + 1} 行开始`}</Tag> : null}
                    {hasFile ? <Tag>{`本次处理 ${count} 条`}</Tag> : null}
                  </Space>
                </>
              )}
              actions={(
                <>
                  <Button
                    type="primary"
                    icon={<CloudUploadOutlined />}
                    disabled={!hasFile || Boolean(validation && !validation.canProceed)}
                    onClick={handleWorkflowTest}
                    className="create-primary-button"
                  >
                    查看流程结果
                  </Button>
                  <Button icon={<HistoryOutlined />} loading={historyLoading} onClick={() => void refreshTaskHistory()}>
                    刷新记录
                  </Button>
                  {hasFile ? <Button onClick={resetSheetState}>清空文件</Button> : null}
                </>
              )}
            />

            <WorkflowPanel
              step={6}
              title="人工检查"
              status={reviewStepStatus}
              summary={!hasResults
                ? "素材准备完成后，这里会承接失败原因、历史批次和人工检查标记。"
                : currentTaskReviewed
                  ? "当前批次已经标记完成人工检查。"
                  : "建议先处理失败项，再抽检成功素材，确认后把这批任务标记为已检查。"}
              detail={hasResults ? (
                <>
                  <Space wrap>
                    <Tag color="success">{`成功 ${successCount}`}</Tag>
                    <Tag color={failCount > 0 ? "error" : "blue"}>{`失败 ${failCount}`}</Tag>
                    <Tag>{`成功率 ${results.length ? Math.round(successCount / results.length * 100) : 0}%`}</Tag>
                  </Space>
                  {normalizedFailedReasonSummary.length > 0 ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      {normalizedFailedReasonSummary.map(([reason, count]) => (
                        <Text key={reason} type="secondary">{`${count} 条：${reason}`}</Text>
                      ))}
                    </div>
                  ) : (
                    <Text type="secondary">这批暂时没有失败项，建议抽检几条成功草稿确认标题、图片和类目。</Text>
                  )}
                </>
              ) : (
                <Text type="secondary">还没有草稿结果时，可以先看下方历史记录，恢复之前的批次继续复核。</Text>
              )}
              actions={(
                <>
                  <Button onClick={toggleReviewed} disabled={!hasResults}>
                    {currentTaskReviewed ? "取消复核标记" : "标记已复核"}
                  </Button>
                  <Button icon={<HistoryOutlined />} loading={historyLoading} onClick={() => void refreshTaskHistory()}>
                    刷新历史
                  </Button>
                </>
              )}
            />
          </div>
        </div>
      )}

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
              <Tag color="cyan">服饰鞋 {filterSummary.excludedSummary?.clothing || 0}</Tag>
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
                  <Title level={4} style={{ marginBottom: 8 }}>把商品表格拖到这里</Title>
                  <Text type="secondary" className="studio-dropzone__desc">
                    支持 Excel / CSV。上传后会自动识别标题、图片、分类和价格列。
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
                <Text type="secondary">先导入 Excel 或 CSV，系统会自动识别关键字段。</Text>
              </div>
              <div className="create-flow-hint">
                <Text strong>2. 过滤风险</Text>
                <Text type="secondary">可先剔除液体、膏体、带电、服饰鞋和 IP 等高风险商品。</Text>
              </div>
              <div className="create-flow-hint">
                <Text strong>3. 批量创建</Text>
                <Text type="secondary">确认预览无误后，直接批量生成商品草稿。</Text>
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
                这里重点看标题、图片、分类和价格是否正确，确认后再开始处理。
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
                <Title level={4} style={{ margin: 0 }}>处理进度</Title>
                <Text type="secondary" style={{ display: "block", marginTop: 6 }}>
                  {batchStatusMessage}
                </Text>
              </div>
            </div>

            <div className="create-progress-current">
              <div className="create-progress-current__item create-progress-current__item--wide">
                <span className="create-progress-current__label">当前状态</span>
                <span className="create-progress-current__value">{currentTaskStatusText}</span>
              </div>
              {progressUpdatedAtText ? (
                <div className="create-progress-current__item">
                  <span className="create-progress-current__label">更新时间</span>
                  <span className="create-progress-current__value">{progressUpdatedAtText}</span>
                </div>
              ) : null}
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
        <Alert type="error" showIcon message="本批商品未完成处理" description={normalizeBatchReason(progressInfo.message)} />
      ) : null}

      {hasResults ? (
        <Card className="create-result-card" style={{ borderRadius: 22, borderColor: "#eceff4" }} bodyStyle={{ padding: 24 }}>
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <Title level={4} style={{ margin: 0 }}>处理结果</Title>
              </div>
              <Space wrap>
                <Tag color="blue">{`共 ${results.length} 条`}</Tag>
                <Tag color="success">{`成功 ${successCount}`}</Tag>
                <Tag color="error">{`失败 ${failCount}`}</Tag>
                <Tag>{`成功率 ${results.length ? Math.round(successCount / results.length * 100) : 0}%`}</Tag>
              </Space>
            </div>

            {normalizedFailedReasonSummary.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message="需要你处理的问题"
                description={(
                  <div style={{ display: "grid", gap: 6 }}>
                    {normalizedFailedReasonSummary.map(([reason, count]) => (
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
              columns={resultColumns}
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
          title="最近记录"
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
                          {normalizeBatchReason(task.message, task.errorCategory)}
                        </div>
                      ) : null}
                    </div>
                    <Button size="small" onClick={() => void restoreTaskView(task.taskId)}>
                      {task.running ? "继续查看" : "恢复查看"}
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
  const pageDescription = "同一页保留两条上品流程：AI 生图上品流程走老链路，新上品流程走新的批量上品链路。";

  return (
    <div className="dashboard-shell product-create-shell">
      <PageHeader
        compact
        eyebrow="商品创建"
        title="上品管理"
        subtitle={pageDescription}
        actions={<Tag color="orange">双上品流程</Tag>}
      />

      <div>
        <BatchCreate />
      </div>
    </div>
  );
}
