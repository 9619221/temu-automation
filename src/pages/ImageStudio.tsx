import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Image,
  Input,
  List,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Steps,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import {
  CopyOutlined,
  DownloadOutlined,
  ExportOutlined,
  HistoryOutlined,
  PictureOutlined,
  ReloadOutlined,
  RocketOutlined,
  SettingOutlined,
  StarOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  DEFAULT_IMAGE_TYPES,
  EMPTY_IMAGE_STUDIO_ANALYSIS,
  EMPTY_IMAGE_STUDIO_CONFIG,
  IMAGE_LANGUAGE_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  IMAGE_TYPE_LABELS,
  PRODUCT_MODE_OPTIONS,
  SALES_REGION_OPTIONS,
  arrayToMultiline,
  formatTimestamp,
  getDefaultImageLanguageForRegion,
  hasMaskedValue,
  isConfigMissing,
  multilineToArray,
  normalizeImageStudioAnalysis,
  type ImageStudioAnalysis,
  type ImageStudioConfig,
  type ImageStudioGeneratedImage,
  type ImageStudioHistoryItem,
  type ImageStudioHistorySummary,
  type ImageStudioImageScore,
  type ImageStudioPlan,
  type ImageStudioStatus,
  type NativeImagePayload,
} from "../utils/imageStudio";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const imageStudioAPI = window.electronAPI?.imageStudio;
const TEMU_ORANGE = "#e55b00";
const TEMU_SOFT = "#fff2e8";
const TEMU_BORDER = "#f0f0f0";
const TEMU_PAGE_BG = "#f7f8fa";
const TEMU_TEXT = "#1f2329";
const TEMU_MUTED = "#8c8c8c";
const TEMU_CARD_RADIUS = 22;
const TEMU_CARD_SHADOW = "0 12px 30px rgba(15, 23, 42, 0.08)";
const TEMU_BUTTON_GRADIENT = "linear-gradient(135deg, #ff922b 0%, #ff6a00 100%)";
const TEMU_BUTTON_SHADOW = "0 10px 24px rgba(255, 106, 0, 0.24)";
const TEMU_UPLOAD_BG = "radial-gradient(circle at top, #fff9f3 0%, #ffffff 72%)";
const IMAGE_STUDIO_FAST_MAX_SIDE = 1600;
const IMAGE_STUDIO_FAST_RAW_BYTES = 2.5 * 1024 * 1024;
const IMAGE_STUDIO_FAST_QUALITY = 0.88;

type ResultStatus = "idle" | "queued" | "generating" | "done" | "error";

type ResultState = {
  status: ResultStatus;
  warnings: string[];
  imageUrl?: string;
  error?: string;
  score?: ImageStudioImageScore;
  scoring?: boolean;
};

type ResultStateMap = Record<string, ResultState>;

type ImageVariant = ImageStudioGeneratedImage & {
  score?: ImageStudioImageScore;
  scoring?: boolean;
};

type ImageVariantMap = Record<string, ImageVariant[]>;

const FALLBACK_STATUS: ImageStudioStatus = {
  status: "starting",
  message: "正在启动 AI 出图服务…",
  url: "http://127.0.0.1:3210",
  projectPath: "",
  port: 3210,
  ready: false,
};

function createEmptyResultState(status: ResultStatus = "idle"): ResultState {
  return {
    status,
    warnings: [],
  };
}

function getResultState(map: ResultStateMap, imageType: string): ResultState {
  return map[imageType] || createEmptyResultState();
}

function sortImagesBySelectedTypes(images: ImageStudioGeneratedImage[], selectedTypes: string[]) {
  return [...images].sort((left, right) => {
    const leftIndex = selectedTypes.indexOf(left.imageType);
    const rightIndex = selectedTypes.indexOf(right.imageType);
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
}

function buildImageVariant(
  image: ImageStudioGeneratedImage,
  options: Partial<ImageVariant> = {},
): ImageVariant {
  return {
    ...image,
    variantId: options.variantId || image.variantId || `${image.imageType}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    prompt: options.prompt ?? image.prompt ?? "",
    suggestion: options.suggestion ?? image.suggestion ?? "",
    createdAt: options.createdAt ?? image.createdAt ?? Date.now(),
    active: options.active ?? image.active ?? false,
    score: options.score,
    scoring: options.scoring,
  };
}

function appendVariantToMap(
  previous: ImageVariantMap,
  image: ImageStudioGeneratedImage,
  options: Partial<ImageVariant> = {},
): ImageVariantMap {
  const imageType = image.imageType || "";
  if (!imageType || !image.imageUrl) return previous;

  const current = Array.isArray(previous[imageType]) ? previous[imageType] : [];
  if (current.some((item) => item.imageUrl === image.imageUrl)) {
    return previous;
  }

  return {
    ...previous,
    [imageType]: [...current, buildImageVariant(image, options)],
  };
}

function flattenVariantMap(variantMap: ImageVariantMap, selectedTypes: string[], activeVariantIds: Record<string, string>) {
  const allImages = selectedTypes.flatMap((imageType) => {
    const variants = Array.isArray(variantMap[imageType]) ? variantMap[imageType] : [];
    return variants.map((variant) => ({
      imageType: variant.imageType,
      imageUrl: variant.imageUrl,
      variantId: variant.variantId,
      prompt: variant.prompt,
      suggestion: variant.suggestion,
      createdAt: variant.createdAt,
      active: activeVariantIds[imageType]
        ? activeVariantIds[imageType] === variant.variantId
        : variants[variants.length - 1]?.variantId === variant.variantId,
    }));
  });

  return sortImagesBySelectedTypes(allImages, selectedTypes);
}

function buildRedrawPrompt(basePrompt: string, suggestion: string, imageType: string) {
  return [
    basePrompt.trim(),
    "",
    `请基于同一商品和同一出图目标，重绘这张${IMAGE_TYPE_LABELS[imageType] || imageType}。`,
    "保留原本的商品主体、平台适配要求和整体卖点方向，并严格执行下面这些修改意见：",
    suggestion.trim(),
    "",
    "除上述修改外，其他内容尽量保持一致，输出 1 张新的候选版本。",
  ].filter(Boolean).join("\n");
}

function buildConfigDraft(config: ImageStudioConfig) {
  return {
    analyzeModel: config.analyzeModel,
    analyzeApiKey: "",
    analyzeBaseUrl: config.analyzeBaseUrl,
    generateModel: config.generateModel,
    generateApiKey: "",
    generateBaseUrl: config.generateBaseUrl,
  };
}

async function buildNativeImagePayloads(fileList: UploadFile[]): Promise<NativeImagePayload[]> {
  const validFiles = fileList.flatMap((item) => (item.originFileObj ? [item.originFileObj] : []));

  return Promise.all(
    validFiles.map((file) => optimizeImageStudioFile(file)),
  );
}

async function optimizeImageStudioFile(file: File): Promise<NativeImagePayload> {
  const rawPayload = {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    buffer: await file.arrayBuffer(),
  };

  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size <= IMAGE_STUDIO_FAST_RAW_BYTES) {
    return rawPayload;
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片预处理失败"));
      element.src = objectUrl;
    });

    const maxSide = Math.max(image.naturalWidth, image.naturalHeight);
    if (!maxSide || maxSide <= IMAGE_STUDIO_FAST_MAX_SIDE) {
      return rawPayload;
    }

    const scale = IMAGE_STUDIO_FAST_MAX_SIDE / maxSide;
    const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      return rawPayload;
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const outputType = ["image/jpeg", "image/png", "image/webp"].includes(file.type) ? file.type : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outputType, outputType === "image/png" ? undefined : IMAGE_STUDIO_FAST_QUALITY);
    });

    if (!blob || blob.size >= file.size) {
      return rawPayload;
    }

    return {
      name: file.name,
      type: blob.type || outputType,
      size: blob.size,
      buffer: await blob.arrayBuffer(),
    };
  } catch {
    return rawPayload;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function hasAnalysisContent(analysis: ImageStudioAnalysis) {
  return Boolean(
    analysis.productName.trim()
    || analysis.category.trim()
    || analysis.materials.trim()
    || analysis.colors.trim()
    || analysis.estimatedDimensions.trim()
    || analysis.sellingPoints.length > 0
    || analysis.targetAudience.length > 0
    || analysis.usageScenes.length > 0,
  );
}

function dedupeTextList(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function trimTitle(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function buildTitleSuggestions(analysis: ImageStudioAnalysis) {
  const productName = analysis.productName.trim() || analysis.category.trim() || "商品";
  const category = analysis.category.trim();
  const materials = analysis.materials.trim();
  const colors = analysis.colors.trim();
  const size = analysis.estimatedDimensions.trim();
  const sellingPoints = dedupeTextList(analysis.sellingPoints).slice(0, 3);

  const keywordFocused = trimTitle(
    [productName, category, materials, colors, size, ...sellingPoints.slice(0, 2)].filter(Boolean).join(" | "),
    96,
  );
  const benefitFocused = trimTitle(
    [productName, ...sellingPoints, size].filter(Boolean).join("，"),
    88,
  );
  const conciseFocused = trimTitle(
    [productName, sellingPoints[0], colors || materials].filter(Boolean).join("，"),
    72,
  );

  return [
    { key: "keywords", label: "关键词优化版", text: keywordFocused },
    { key: "benefits", label: "卖点突出版", text: benefitFocused },
    { key: "concise", label: "简洁精炼版", text: conciseFocused },
  ];
}

function sanitizeDownloadNamePart(value: string) {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || "image";
}

function getImageExtensionFromMimeType(mimeType?: string) {
  if (!mimeType) return "";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "";
}

function getImageExtensionFromUrl(imageUrl: string) {
  const dataUrlMatch = imageUrl.match(/^data:image\/([a-z0-9.+-]+);/i);
  if (dataUrlMatch?.[1]) {
    const dataExtension = dataUrlMatch[1].toLowerCase();
    return dataExtension === "jpeg" ? "jpg" : dataExtension;
  }

  const cleanUrl = imageUrl.split("#")[0]?.split("?")[0] || "";
  const extensionMatch = cleanUrl.match(/\.([a-z0-9]{2,5})$/i);
  return extensionMatch?.[1]?.toLowerCase() || "";
}

function triggerImageDownload(href: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export default function ImageStudio() {
  const [status, setStatus] = useState<ImageStudioStatus>(FALLBACK_STATUS);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [config, setConfig] = useState<ImageStudioConfig>(EMPTY_IMAGE_STUDIO_CONFIG);
  const [configDraft, setConfigDraft] = useState(buildConfigDraft(EMPTY_IMAGE_STUDIO_CONFIG));
  const [historyItems, setHistoryItems] = useState<ImageStudioHistorySummary[]>([]);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [productMode, setProductMode] = useState("single");
  const [salesRegion, setSalesRegion] = useState("us");
  const [imageLanguage, setImageLanguage] = useState(getDefaultImageLanguageForRegion("us"));
  const [imageSize, setImageSize] = useState("800x800");
  const [selectedImageTypes, setSelectedImageTypes] = useState<string[]>(DEFAULT_IMAGE_TYPES);
  const [analysis, setAnalysis] = useState<ImageStudioAnalysis>(EMPTY_IMAGE_STUDIO_ANALYSIS);
  const [plans, setPlans] = useState<ImageStudioPlan[]>([]);
  const [results, setResults] = useState<ResultStateMap>({});
  const [imageVariants, setImageVariants] = useState<ImageVariantMap>({});
  const [activeVariantIds, setActiveVariantIds] = useState<Record<string, string>>({});
  const [redrawSuggestions, setRedrawSuggestions] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadingTypes, setDownloadingTypes] = useState<Record<string, boolean>>({});
  const [redrawingTypes, setRedrawingTypes] = useState<Record<string, boolean>>({});
  const [currentJobId, setCurrentJobId] = useState("");
  const [activeStep, setActiveStep] = useState(0);
  const [backgroundJobs, setBackgroundJobs] = useState<any[]>([]);

  const currentJobIdRef = useRef("");
  const productNameRef = useRef("");
  const salesRegionRef = useRef("us");
  const selectedImageTypesRef = useRef<string[]>(DEFAULT_IMAGE_TYPES);
  const plansRef = useRef<ImageStudioPlan[]>([]);
  const imageVariantsRef = useRef<ImageVariantMap>({});
  const activeVariantIdsRef = useRef<Record<string, string>>({});
  const currentJobModeRef = useRef<"full" | "redraw">("full");
  const currentRedrawMetaRef = useRef<{ imageType: string; suggestion: string; prompt: string } | null>(null);

  useEffect(() => {
    currentJobIdRef.current = currentJobId;
  }, [currentJobId]);

  useEffect(() => {
    productNameRef.current = analysis.productName;
  }, [analysis.productName]);

  useEffect(() => {
    salesRegionRef.current = salesRegion;
  }, [salesRegion]);

  useEffect(() => {
    selectedImageTypesRef.current = selectedImageTypes;
  }, [selectedImageTypes]);

  useEffect(() => {
    plansRef.current = plans;
  }, [plans]);

  useEffect(() => {
    imageVariantsRef.current = imageVariants;
  }, [imageVariants]);

  useEffect(() => {
    activeVariantIdsRef.current = activeVariantIds;
  }, [activeVariantIds]);

  const refreshStatus = async (ensure = false) => {
    try {
      if (!imageStudioAPI) throw new Error("当前环境不支持 AI 出图服务");
      if (ensure) {
        setStatus((prev) => ({
          ...prev,
          status: "starting",
          message: "正在启动 AI 出图服务…",
          ready: false,
        }));
      }
      setActionLoading(ensure);
      const nextStatus = ensure
        ? await imageStudioAPI.ensureRunning()
        : await imageStudioAPI.getStatus();
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      const nextStatus = {
        ...FALLBACK_STATUS,
        status: "error",
        message: error instanceof Error ? error.message : "AI 出图服务启动失败",
      };
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setLoading(false);
      setActionLoading(false);
    }
  };

  const loadConfig = async () => {
    if (!imageStudioAPI) return;
    setConfigLoading(true);
    try {
      const nextConfig = await imageStudioAPI.getConfig();
      setConfig(nextConfig);
      setConfigDraft(buildConfigDraft(nextConfig));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取配置失败");
    } finally {
      setConfigLoading(false);
    }
  };

  const refreshBackgroundJobs = async () => {
    if (!imageStudioAPI) return;
    try {
      const jobs = await imageStudioAPI.listJobs();
      setBackgroundJobs(Array.isArray(jobs) ? jobs : []);
    } catch {}
  };

  const loadHistory = async () => {
    if (!imageStudioAPI) return;
    setHistoryLoading(true);
    try {
      const list = await imageStudioAPI.listHistory();
      setHistoryItems(Array.isArray(list) ? list : []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取历史失败");
    } finally {
      setHistoryLoading(false);
    }
  };

  const appendGeneratedVariant = (
    image: ImageStudioGeneratedImage,
    options: { prompt?: string; suggestion?: string; activate?: boolean } = {},
  ) => {
    const nextVariant = buildImageVariant(image, {
      prompt: options.prompt,
      suggestion: options.suggestion,
    });

    setImageVariants((prev) => appendVariantToMap(prev, nextVariant, nextVariant));
    if (options.activate !== false) {
      setActiveVariantIds((prev) => ({
        ...prev,
        [image.imageType]: nextVariant.variantId || "",
      }));
    }
  };

  const getActiveVariant = (imageType: string) => {
    const variants = imageVariants[imageType] || [];
    if (variants.length === 0) return null;
    const activeVariantId = activeVariantIds[imageType];
    return variants.find((item) => item.variantId === activeVariantId) || variants[variants.length - 1];
  };

  useEffect(() => {
    refreshStatus(true).then((nextStatus) => {
      if (nextStatus.ready) {
        loadConfig().catch(() => {});
        loadHistory().catch(() => {});
        refreshBackgroundJobs();
      }
    }).catch(() => {});

    const timer = window.setInterval(() => {
      refreshStatus(false).catch(() => {});
      refreshBackgroundJobs();
    }, 8000);

    const unsubscribe = window.electronAPI?.onImageStudioEvent?.((payload) => {
      if (!payload) return;

      // 后台 job 完成/失败时刷新后台任务列表
      if (payload.type === "generate:complete" || payload.type === "generate:error" || payload.type === "generate:cancelled") {
        refreshBackgroundJobs();
        if (payload.type === "generate:complete") {
          loadHistory().catch(() => {});
        }
      }

      // 只有当前前台 job 才更新详细 UI 状态
      if (payload.jobId !== currentJobIdRef.current) return;

      if (payload.type === "generate:event" && payload.event?.imageType) {
        const imageType = payload.event?.imageType || "";
        startTransition(() => {
          setResults((prev) => {
            const next = { ...prev };
            const current = getResultState(next, imageType);

            if (payload.event?.status === "generating") {
              next[imageType] = { ...current, status: "generating", error: "" };
            } else if (payload.event?.status === "warning") {
              next[imageType] = {
                ...current,
                warnings: Array.isArray(payload.event.warnings) ? payload.event.warnings : current.warnings,
              };
            } else if (payload.event?.status === "done") {
              next[imageType] = {
                ...current,
                status: "done",
                imageUrl: payload.event.imageUrl,
                warnings: Array.isArray(payload.event.warnings) ? payload.event.warnings : current.warnings,
                error: "",
              };
            } else if (payload.event?.status === "error") {
              next[imageType] = {
                ...current,
                status: "error",
                error: payload.event.error || "生成失败",
              };
            }

            return next;
          });
        });

        if (payload.event?.status === "done" && payload.event?.imageUrl) {
          const isRedraw = currentJobModeRef.current === "redraw" && currentRedrawMetaRef.current?.imageType === imageType;
          const currentPlan = plansRef.current.find((plan) => plan.imageType === imageType);
          appendGeneratedVariant(
            {
              imageType,
              imageUrl: payload.event.imageUrl,
            },
            {
              prompt: isRedraw ? currentRedrawMetaRef.current?.prompt : currentPlan?.prompt,
              suggestion: isRedraw ? currentRedrawMetaRef.current?.suggestion : "",
              activate: true,
            },
          );
        }
      }

      if (payload.type === "generate:complete") {
        setGenerating(false);
        setCurrentJobId("");
        const redrawMeta = currentRedrawMetaRef.current;
        const wasRedraw = currentJobModeRef.current === "redraw";
        const completedImages = sortImagesBySelectedTypes(Array.isArray(payload.results) ? payload.results : [], selectedImageTypesRef.current);
        const nextVariantMap = completedImages.reduce<ImageVariantMap>((acc, item) => {
          const currentPlan = plansRef.current.find((plan) => plan.imageType === item.imageType);
          return appendVariantToMap(acc, item, {
            prompt: wasRedraw && redrawMeta?.imageType === item.imageType ? redrawMeta.prompt : currentPlan?.prompt,
            suggestion: wasRedraw && redrawMeta?.imageType === item.imageType ? redrawMeta.suggestion : "",
          });
        }, imageVariantsRef.current);
        const nextActiveVariantIds = { ...activeVariantIdsRef.current };
        completedImages.forEach((item) => {
          const latestVariant = nextVariantMap[item.imageType]?.[nextVariantMap[item.imageType].length - 1];
          if (latestVariant?.variantId) {
            nextActiveVariantIds[item.imageType] = latestVariant.variantId;
          }
        });
        setImageVariants(nextVariantMap);
        setActiveVariantIds(nextActiveVariantIds);
        if (redrawMeta?.imageType) {
          setRedrawingTypes((prev) => ({ ...prev, [redrawMeta.imageType]: false }));
        }
        currentJobModeRef.current = "full";
        currentRedrawMetaRef.current = null;
        if (wasRedraw && redrawMeta?.imageType) {
          const redrawLabel = IMAGE_TYPE_LABELS[redrawMeta.imageType] || redrawMeta.imageType;
          if (payload.historySaveError) {
            message.warning(`${redrawLabel} 已新增一个候选版本，但自动保存历史失败：${payload.historySaveError}`);
          } else if (payload.historySaved) {
            message.success(`${redrawLabel} 已新增一个候选版本，并已自动保存到历史记录`);
          } else {
            message.success(`${redrawLabel} 已新增一个候选版本`);
          }
        } else {
          if (payload.historySaveError) {
            message.warning(`AI 出图已完成，但自动保存历史失败：${payload.historySaveError}`);
          } else if (payload.historySaved) {
            message.success("AI 出图已完成，并已自动保存到历史记录");
          } else {
            message.success("AI 出图已完成");
          }
        }
      }

      if (payload.type === "generate:error") {
        setGenerating(false);
        setCurrentJobId("");
        const redrawMeta = currentRedrawMetaRef.current;
        if (redrawMeta?.imageType) {
          setRedrawingTypes((prev) => ({ ...prev, [redrawMeta.imageType]: false }));
        }
        currentJobModeRef.current = "full";
        currentRedrawMetaRef.current = null;
        message.error(payload.error || "AI 出图失败");
      }

      if (payload.type === "generate:cancelled") {
        setGenerating(false);
        setCurrentJobId("");
        const redrawMeta = currentRedrawMetaRef.current;
        if (redrawMeta?.imageType) {
          setRedrawingTypes((prev) => ({ ...prev, [redrawMeta.imageType]: false }));
        }
        currentJobModeRef.current = "full";
        currentRedrawMetaRef.current = null;
        message.info(payload.message || "已取消本次生成");
      }
    });

    return () => {
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, []);

  const handleRestart = async () => {
    setActionLoading(true);
    try {
      if (!imageStudioAPI) throw new Error("当前环境不支持 AI 出图服务");
      const nextStatus = await imageStudioAPI.restart();
      setStatus(nextStatus);
      await loadConfig();
      message.success("AI 出图服务已重启");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "重启失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenExternal = async () => {
    try {
      if (!imageStudioAPI) throw new Error("当前环境不支持");
      await imageStudioAPI.openExternal();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "打开失败");
    }
  };

  const handleOpenConfig = async () => {
    setConfigOpen(true);
    await loadConfig();
  };

  const handleSaveConfig = async () => {
    if (!imageStudioAPI) return;
    setConfigLoading(true);
    try {
      const nextConfig = await imageStudioAPI.updateConfig({
        analyzeModel: configDraft.analyzeModel.trim(),
        analyzeApiKey: configDraft.analyzeApiKey.trim(),
        analyzeBaseUrl: configDraft.analyzeBaseUrl.trim(),
        generateModel: configDraft.generateModel.trim(),
        generateApiKey: configDraft.generateApiKey.trim(),
        generateBaseUrl: configDraft.generateBaseUrl.trim(),
      });
      setConfig(nextConfig);
      setConfigDraft(buildConfigDraft(nextConfig));
      setConfigOpen(false);
      message.success("AI 出图配置已更新");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存配置失败");
    } finally {
      setConfigLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!imageStudioAPI) return;
    if (uploadFiles.length === 0) {
      message.warning("请先上传商品素材图");
      return;
    }

    setAnalyzing(true);
    try {
      const files = await buildNativeImagePayloads(uploadFiles);
      const payload = await imageStudioAPI.analyze({ files, productMode });
      setAnalysis(normalizeImageStudioAnalysis(payload));
      setPlans([]);
      setResults({});
      setImageVariants({});
      setActiveVariantIds({});
      setRedrawSuggestions({});
      setRedrawingTypes({});
      setActiveStep(1);
      message.success("商品分析已完成");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "分析失败");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRegenerateAnalysis = async () => {
    if (!imageStudioAPI) return;
    if (uploadFiles.length === 0) {
      message.warning("请先上传商品素材图");
      return;
    }
    if (!analysis.productName.trim()) {
      message.warning("请先完成一次分析，或先补充商品名称");
      return;
    }

    setRegenerating(true);
    try {
      const files = await buildNativeImagePayloads(uploadFiles);
      const payload = await imageStudioAPI.regenerateAnalysis({ files, productMode, analysis });
      setAnalysis((prev) => ({
        ...prev,
        sellingPoints: Array.isArray(payload.sellingPoints) ? payload.sellingPoints : prev.sellingPoints,
        targetAudience: Array.isArray(payload.targetAudience) ? payload.targetAudience : prev.targetAudience,
        usageScenes: Array.isArray(payload.usageScenes) ? payload.usageScenes : prev.usageScenes,
      }));
      message.success("卖点、人群和场景已重新生成");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  };

  const generatePlansForCurrentAnalysis = async () => {
    if (!imageStudioAPI) return;
    if (!analysis.productName.trim()) {
      message.warning("请先完成商品分析或补充商品信息");
      return null;
    }
    if (selectedImageTypes.length === 0) {
      message.warning("请至少选择一种出图类型");
      return null;
    }

    try {
      const nextPlans = await imageStudioAPI.generatePlans({
        analysis,
        imageTypes: selectedImageTypes,
        salesRegion,
        imageSize,
        productMode,
      });
      const normalizedPlans = Array.isArray(nextPlans) ? nextPlans : [];
      setPlans(normalizedPlans);
      return normalizedPlans;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "生成方案失败");
      return null;
    }
  };

  const handleGeneratePlans = async () => {
    setPlanning(true);
    try {
      const normalizedPlans = await generatePlansForCurrentAnalysis();
      setResults({});
      setImageVariants({});
      setActiveVariantIds({});
      setRedrawSuggestions({});
      setRedrawingTypes({});
      if (normalizedPlans && normalizedPlans.length > 0) {
        setActiveStep(2);
        message.success(`已生成 ${normalizedPlans.length} 条出图方案`);
      } else if (normalizedPlans) {
        message.warning("服务未返回可用方案，请检查分析结果或重试");
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "生成方案失败");
    } finally {
      setPlanning(false);
    }
  };

  const handleStartGenerate = async (runInBackground = false) => {
    if (!imageStudioAPI) return;
    if (uploadFiles.length === 0) {
      message.warning("请先上传商品素材图");
      return;
    }
    if (plans.length === 0) {
      message.warning("请先生成出图方案");
      return;
    }
    const nextJobId = `image_job_${Date.now()}`;

    if (!runInBackground) {
      setGenerating(true);
      setCurrentJobId(nextJobId);
      currentJobModeRef.current = "full";
      currentRedrawMetaRef.current = null;
      setResults(plans.reduce<ResultStateMap>((acc, plan) => {
        acc[plan.imageType] = createEmptyResultState("queued");
        return acc;
      }, {}));
      setImageVariants({});
      setActiveVariantIds({});
      setRedrawSuggestions({});
      setRedrawingTypes({});
    }

    try {
      const files = await buildNativeImagePayloads(uploadFiles);
      if (!runInBackground) setActiveStep(3);
      await imageStudioAPI.startGenerate({
        jobId: nextJobId,
        files,
        plans,
        productMode,
        runInBackground,
        salesRegion,
        imageLanguage,
        imageSize,
        productName: analysis.productName || "未命名商品",
      });
      if (runInBackground) {
        message.success(`「${analysis.productName || "未命名商品"}」已在后台生成，完成后会自动保存到历史记录`);
        refreshBackgroundJobs();
        resetStudio();
      } else {
        message.success("AI 出图任务已开始");
      }
    } catch (error) {
      if (!runInBackground) {
        setGenerating(false);
        setCurrentJobId("");
      }
      message.error(error instanceof Error ? error.message : "启动出图失败");
    }
  };

  const handleCancelGenerate = async () => {
    if (!imageStudioAPI || !currentJobId) return;
    try {
      await imageStudioAPI.cancelGenerate(currentJobId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "取消失败");
    }
  };

  const handleOpenHistory = async () => {
    setHistoryOpen(true);
    await loadHistory();
  };

  const handleLoadHistoryItem = async (item: ImageStudioHistorySummary) => {
    if (!imageStudioAPI) return;
    try {
      const detail = await imageStudioAPI.getHistoryItem(item.id);
      if (!detail) {
        message.warning("历史记录不存在或已失效");
        return;
      }

      const historyItem = detail as ImageStudioHistoryItem;
      const nextSelectedTypes = Array.from(new Set(historyItem.images.map((image) => image.imageType).filter(Boolean)));
      const nextVariants = historyItem.images.reduce<ImageVariantMap>((acc, image) => {
        const variant = buildImageVariant(image, image);
        const current = Array.isArray(acc[variant.imageType]) ? acc[variant.imageType] : [];
        acc[variant.imageType] = [...current, variant];
        return acc;
      }, {});
      const nextActiveVariantIds = Object.fromEntries(
        Object.entries(nextVariants).map(([imageType, variants]) => {
          const activeVariant = variants.find((variant) => variant.active) || variants[variants.length - 1];
          return [imageType, activeVariant?.variantId || ""];
        }),
      );

      setAnalysis((prev) => ({ ...prev, productName: historyItem.productName || prev.productName }));
      setSalesRegion(historyItem.salesRegion || "us");
      setImageLanguage(getDefaultImageLanguageForRegion(historyItem.salesRegion || "us"));
      setSelectedImageTypes(nextSelectedTypes);
      setPlans(nextSelectedTypes.map((imageType) => {
        const activeVariant = nextVariants[imageType]?.find((variant) => variant.variantId === nextActiveVariantIds[imageType]) || nextVariants[imageType]?.[nextVariants[imageType].length - 1];
        return { imageType, prompt: activeVariant?.prompt || "" };
      }));
      setImageVariants(nextVariants);
      setActiveVariantIds(nextActiveVariantIds);
      setRedrawSuggestions(Object.fromEntries(
        nextSelectedTypes.map((imageType) => {
          const activeVariant = nextVariants[imageType]?.find((variant) => variant.variantId === nextActiveVariantIds[imageType]) || nextVariants[imageType]?.[nextVariants[imageType].length - 1];
          return [imageType, activeVariant?.suggestion || ""];
        }),
      ));
      setResults(nextSelectedTypes.reduce<ResultStateMap>((acc, imageType) => {
        const activeVariant = nextVariants[imageType]?.find((variant) => variant.variantId === nextActiveVariantIds[imageType]) || nextVariants[imageType]?.[nextVariants[imageType].length - 1];
        acc[imageType] = { status: "done", imageUrl: activeVariant?.imageUrl || "", warnings: [] };
        return acc;
      }, {}));
      setActiveStep(3);
      setHistoryOpen(false);
      message.success("已载入历史出图结果");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取历史详情失败");
    }
  };

  const handleScoreImage = async (imageType: string, variantId?: string) => {
    if (!imageStudioAPI) return;
    const variants = imageVariants[imageType] || [];
    const targetVariant = variants.find((item) => item.variantId === variantId) || getActiveVariant(imageType);
    if (!targetVariant?.imageUrl) return;

    setImageVariants((prev) => ({
      ...prev,
      [imageType]: (prev[imageType] || []).map((variant) => (
        variant.variantId === targetVariant.variantId
          ? { ...variant, scoring: true }
          : variant
      )),
    }));

    try {
      const score = await imageStudioAPI.scoreImage({ imageType, imageUrl: targetVariant.imageUrl });
      setImageVariants((prev) => ({
        ...prev,
        [imageType]: (prev[imageType] || []).map((variant) => (
          variant.variantId === targetVariant.variantId
            ? { ...variant, scoring: false, score }
            : variant
        )),
      }));
      message.success(`${IMAGE_TYPE_LABELS[imageType] || imageType} 评分完成`);
    } catch (error) {
      setImageVariants((prev) => ({
        ...prev,
        [imageType]: (prev[imageType] || []).map((variant) => (
          variant.variantId === targetVariant.variantId
            ? { ...variant, scoring: false }
            : variant
        )),
      }));
      message.error(error instanceof Error ? error.message : "评分失败");
    }
  };

  const updateAnalysisField = <K extends keyof ImageStudioAnalysis>(field: K, value: ImageStudioAnalysis[K]) => {
    setAnalysis((prev) => ({ ...prev, [field]: value }));
  };

  const updatePlanPrompt = (imageType: string, prompt: string) => {
    setPlans((prev) => prev.map((plan) => (
      plan.imageType === imageType
        ? { ...plan, prompt }
        : plan
    )));
  };

  const copyText = async (value: string, successText = "已复制") => {
    const nextValue = value.trim();
    if (!nextValue) {
      message.warning("没有可复制的内容");
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(nextValue);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = nextValue;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      message.success(successText);
    } catch {
      message.error("复制失败，请手动复制");
    }
  };

  const handleSingleRedraw = async (imageType: string) => {
    if (!imageStudioAPI) return;
    if (generating) {
      message.warning("当前还有生成任务在运行，请先等待完成或取消");
      return;
    }
    if (uploadFiles.length === 0) {
      message.warning("请先上传商品素材图");
      return;
    }

    const suggestion = (redrawSuggestions[imageType] || "").trim();
    if (!suggestion) {
      message.warning("先输入你的修改建议，再重绘这张图");
      return;
    }

    const basePlan = plans.find((plan) => plan.imageType === imageType);
    if (!basePlan) {
      message.warning("当前图类型还没有出图方案，请先生成方案");
      return;
    }

    const activeVariant = getActiveVariant(imageType);
    const nextPrompt = buildRedrawPrompt(activeVariant?.prompt?.trim() || basePlan.prompt, suggestion, imageType);
    const redrawPlan: ImageStudioPlan = {
      ...basePlan,
      prompt: nextPrompt,
      title: `${basePlan.title || IMAGE_TYPE_LABELS[imageType] || imageType} · 候选重绘`,
    };
    const nextJobId = `image_redraw_${imageType}_${Date.now()}`;

    setGenerating(true);
    setCurrentJobId(nextJobId);
    currentJobModeRef.current = "redraw";
    currentRedrawMetaRef.current = { imageType, suggestion, prompt: nextPrompt };
    setRedrawingTypes((prev) => ({ ...prev, [imageType]: true }));
    setResults((prev) => ({
      ...prev,
      [imageType]: { ...getResultState(prev, imageType), status: "generating", error: "" },
    }));

    try {
      const files = await buildNativeImagePayloads(uploadFiles);
      await imageStudioAPI.startGenerate({
        jobId: nextJobId,
        files,
        plans: [redrawPlan],
        productMode,
        runInBackground: false,
        salesRegion,
        imageLanguage,
        imageSize,
      });
      message.success(`已开始重绘 ${IMAGE_TYPE_LABELS[imageType] || imageType}`);
    } catch (error) {
      setGenerating(false);
      setCurrentJobId("");
      currentJobModeRef.current = "full";
      currentRedrawMetaRef.current = null;
      setRedrawingTypes((prev) => ({ ...prev, [imageType]: false }));
      message.error(error instanceof Error ? error.message : "启动重绘失败");
    }
  };

  const downloadImage = async (image: ImageStudioGeneratedImage) => {
    const baseName = sanitizeDownloadNamePart(analysis.productName || "temu-image");
    const typeName = sanitizeDownloadNamePart(IMAGE_TYPE_LABELS[image.imageType] || image.imageType);

    try {
      const response = await fetch(image.imageUrl);
      if (!response.ok) {
        throw new Error(`下载失败（${response.status}）`);
      }

      const blob = await response.blob();
      const extension = getImageExtensionFromMimeType(blob.type) || getImageExtensionFromUrl(image.imageUrl) || "png";
      const objectUrl = URL.createObjectURL(blob);

      try {
        triggerImageDownload(objectUrl, `${baseName}-${typeName}.${extension}`);
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch {
      const fallbackExtension = getImageExtensionFromUrl(image.imageUrl) || "png";
      triggerImageDownload(image.imageUrl, `${baseName}-${typeName}.${fallbackExtension}`);
    }
  };

  const generatedImages = useMemo(() => {
    const list = selectedImageTypes.flatMap((imageType) => {
      const variants = imageVariants[imageType] || [];
      const activeVariantId = activeVariantIds[imageType];
      const activeVariant = variants.find((item) => item.variantId === activeVariantId) || variants[variants.length - 1];
      if (activeVariant?.imageUrl) {
        return [activeVariant];
      }
      const result = results[imageType];
      return result?.imageUrl ? [{ imageType, imageUrl: result.imageUrl }] : [];
    });
    return sortImagesBySelectedTypes(list, selectedImageTypes);
  }, [activeVariantIds, imageVariants, results, selectedImageTypes]);

  const planCount = plans.length || selectedImageTypes.length;
  const completedCount = useMemo(
    () => Object.values(results).filter((result) => result.status === "done" || result.status === "error").length,
    [results],
  );
  const successCount = useMemo(
    () => Object.values(results).filter((result) => result.status === "done").length,
    [results],
  );
  const progressPercent = planCount > 0 ? Math.round((completedCount / planCount) * 100) : 0;
  const hasUploads = uploadFiles.length > 0;
  const hasAnalysis = useMemo(() => hasAnalysisContent(analysis), [analysis]);
  const hasPlans = plans.length > 0;
  const maxUnlockedStep = generating || generatedImages.length > 0 || hasPlans ? 3 : hasAnalysis ? 2 : hasUploads ? 1 : 0;
  const nextStepHint = !hasUploads
    ? "先上传商品素材图"
    : !hasAnalysis
      ? "先分析商品"
      : !hasPlans
        ? "先生成方案"
        : generating
          ? "正在生成图片"
          : "可以开始出图";
  const selectedTypeLabels = useMemo(
    () => selectedImageTypes.map((type) => IMAGE_TYPE_LABELS[type] || type),
    [selectedImageTypes],
  );
  const titleSuggestions = useMemo(() => buildTitleSuggestions(analysis), [analysis]);
  const stepItems = [
    { title: "上传图片", description: "上传商品素材并选择市场" },
    { title: "AI 分析", description: "确认商品信息和卖点" },
    { title: "确认方案", description: "确认每张图的出图方案" },
    { title: "生成图片", description: "执行生成并查看结果" },
  ];

  const renderStatusTag = () => {
    if (status.ready) return <Tag color={configAlertNeeded ? "orange" : "success"}>{serviceLabel}</Tag>;
    if (status.status === "starting") return <Tag color="processing">{serviceLabel}</Tag>;
    if (status.status === "error") return <Tag color="error">{serviceLabel}</Tag>;
    return <Tag>{serviceLabel}</Tag>;
  };

  const configAlertNeeded = status.ready && isConfigMissing(config);
  const serviceLabel = status.ready ? (configAlertNeeded ? "待配置" : "已就绪") : status.status === "error" ? "服务异常" : "启动中";
  const serviceColor = status.ready ? (configAlertNeeded ? TEMU_ORANGE : "#16a34a") : status.status === "error" ? "#ff4d4f" : "#faad14";

  const handleStepChange = (nextStep: number) => {
    if (nextStep <= maxUnlockedStep) {
      setActiveStep(nextStep);
    }
  };

  const regionCards = [
    { value: "us", code: "US", label: "美国" },
    { value: "eu", code: "EU", label: "欧洲" },
    { value: "uk", code: "GB", label: "英国" },
    { value: "jp", code: "JP", label: "日本" },
    { value: "kr", code: "KR", label: "韩国" },
    { value: "cn", code: "CN", label: "中国" },
    { value: "sea", code: "TH", label: "东南亚" },
    { value: "me", code: "SA", label: "中东" },
    { value: "latam", code: "MX", label: "拉美" },
    { value: "br", code: "BR", label: "巴西" },
  ];


  const handleDownloadImage = async (image: ImageStudioGeneratedImage) => {
    const downloadKey = image.variantId || `${image.imageType}:${image.imageUrl}`;
    setDownloadingTypes((prev) => ({ ...prev, [downloadKey]: true }));

    try {
      await downloadImage(image);
      message.success(`${IMAGE_TYPE_LABELS[image.imageType] || image.imageType} 已开始下载`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "下载图片失败");
    } finally {
      setDownloadingTypes((prev) => {
        const next = { ...prev };
        delete next[downloadKey];
        return next;
      });
    }
  };

  const handleDownloadAllImages = async () => {
    if (generatedImages.length === 0) {
      message.warning("当前还没有可下载的图片");
      return;
    }

    setDownloadingAll(true);
    let success = 0;

    try {
      for (const image of generatedImages) {
        try {
          await downloadImage(image);
          success += 1;
          await new Promise((resolve) => window.setTimeout(resolve, 120));
        } catch {
          // Continue downloading the remaining images so one bad image doesn't block the batch.
        }
      }

      if (success === generatedImages.length) {
        message.success(`已开始下载 ${success} 张图片`);
      } else if (success > 0) {
        message.warning(`已开始下载 ${success}/${generatedImages.length} 张图片，剩余图片请单独重试`);
      } else {
        message.error("批量下载失败，请重试");
      }
    } finally {
      setDownloadingAll(false);
    }
  };

  const resetStudio = () => {
    setUploadFiles([]);
    setAnalysis(EMPTY_IMAGE_STUDIO_ANALYSIS);
    setPlans([]);
    setResults({});
    setImageVariants({});
    setActiveVariantIds({});
    setRedrawSuggestions({});
    setRedrawingTypes({});
    setGenerating(false);
    setCurrentJobId("");
    currentJobModeRef.current = "full";
    currentRedrawMetaRef.current = null;
    setActiveStep(0);
  };

  const renderStepZero = () => (
    <Card
      style={{
        borderRadius: TEMU_CARD_RADIUS,
        borderColor: "#f1e5da",
        boxShadow: TEMU_CARD_SHADOW,
        background: "#ffffff",
      }}
      bodyStyle={{ padding: hasUploads ? 22 : 28 }}
    >
      <Space direction="vertical" size={hasUploads ? 22 : 18} style={{ width: "100%" }}>
        <div
          style={{
            maxWidth: 680,
            width: "100%",
            margin: "0 auto",
            border: "1.5px dashed #ff9f5a",
            borderRadius: 28,
            background: TEMU_UPLOAD_BG,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
            padding: hasUploads ? "26px 24px 22px" : "56px 24px 46px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 18,
              margin: "0 auto 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: TEMU_BUTTON_GRADIENT,
              boxShadow: TEMU_BUTTON_SHADOW,
            }}
          >
            <UploadOutlined style={{ color: "#fff", fontSize: 28 }} />
          </div>

          <Title level={4} style={{ marginBottom: 8, color: TEMU_TEXT }}>拖拽商品图片到此处</Title>
          <Text type="secondary" style={{ fontSize: 14 }}>
            支持多张图片（最多 5 张），适合组合装/套装
          </Text>

          <div style={{ marginTop: 22 }}>
            <Upload
              accept="image/*"
              listType="picture"
              multiple
              beforeUpload={() => false}
              fileList={uploadFiles}
              maxCount={5}
              onChange={({ fileList }) => setUploadFiles(fileList.slice(-5))}
              showUploadList={false}
            >
              <Button
                type="primary"
                size="large"
                icon={<UploadOutlined />}
                style={{
                  minWidth: 128,
                  height: 42,
                  borderRadius: 14,
                  border: "none",
                  background: TEMU_BUTTON_GRADIENT,
                  boxShadow: TEMU_BUTTON_SHADOW,
                }}
              >
                {hasUploads ? "继续添加" : "选择图片"}
              </Button>
            </Upload>
          </div>

          {hasUploads ? (
            <div style={{ marginTop: 22 }}>
              <Text type="secondary">已上传 {uploadFiles.length}/5 张商品图</Text>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
                <Upload
                  accept="image/*"
                  listType="picture-card"
                  multiple
                  beforeUpload={() => false}
                  fileList={uploadFiles}
                  maxCount={5}
                  onChange={({ fileList }) => setUploadFiles(fileList.slice(-5))}
                >
                  {uploadFiles.length < 5 ? (
                    <div>
                      <UploadOutlined />
                      <div style={{ marginTop: 6, fontSize: 12 }}>添加</div>
                    </div>
                  ) : null}
                </Upload>
              </div>
            </div>
          ) : null}
        </div>

        {hasUploads ? (
          <div style={{ maxWidth: 680, margin: "0 auto", width: "100%" }}>
            <Card
              size="small"
              style={{
                borderRadius: 18,
                background: "#fbfdff",
                borderColor: "#dfe7f3",
                boxShadow: "none",
              }}
              bodyStyle={{ padding: 18 }}
            >
              <Text strong style={{ display: "block", marginBottom: 14, color: TEMU_TEXT }}>
                销售地区
                <Text type="secondary" style={{ marginLeft: 8, fontWeight: 400 }}>
                  决定图片语言和风格
                </Text>
              </Text>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 }}>
                {regionCards.map((region) => {
                  const isSelected = salesRegion === region.value;
                  return (
                    <button
                      key={region.value}
                      type="button"
                      onClick={() => {
                        setSalesRegion(region.value);
                        setImageLanguage(getDefaultImageLanguageForRegion(region.value));
                      }}
                      style={{
                        minHeight: 64,
                        padding: "10px 8px",
                        borderRadius: 12,
                        border: isSelected ? "1px solid #ff8c3a" : "1px solid #d9e1ea",
                        background: isSelected ? TEMU_BUTTON_GRADIENT : "#ffffff",
                        color: isSelected ? "#ffffff" : "#314156",
                        cursor: "pointer",
                        textAlign: "center",
                        boxShadow: isSelected ? "0 10px 20px rgba(255, 106, 0, 0.18)" : "none",
                        transition: "background-color 0.2s, color 0.2s, box-shadow 0.2s, border-color 0.2s",
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{region.code}</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>{region.label}</div>
                    </button>
                  );
                })}
              </div>

              <div
                style={{
                  marginTop: 14,
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "#f5f8ff",
                  color: "#7a8ca8",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                当前地区：
                {regionCards.find((region) => region.value === salesRegion)?.label || salesRegion}
                ，图片语言
                {IMAGE_LANGUAGE_OPTIONS.find((option) => option.value === imageLanguage)?.label || imageLanguage}
              </div>
            </Card>

            <div style={{ textAlign: "center", marginTop: 24 }}>
              <Button
                type="primary"
                size="large"
                icon={<RocketOutlined />}
                onClick={handleAnalyze}
                loading={analyzing}
                disabled={!hasUploads}
                style={{
                  minWidth: 260,
                  height: 48,
                  fontSize: 16,
                  borderRadius: 16,
                  border: "none",
                  background: TEMU_BUTTON_GRADIENT,
                  boxShadow: TEMU_BUTTON_SHADOW,
                }}
              >
                {"开始 AI 分析（" + uploadFiles.length + " 张图）"}
              </Button>
            </div>
          </div>
        ) : null}

        <div style={{ textAlign: "center" }}>
          <Text type="secondary">上传 1-5 张商品图，支持组合装/套装多商品</Text>
        </div>
      </Space>
    </Card>
  );

  const renderStepOne = () => (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {/* 素材缩略图 */}
      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 8, padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <Text style={{ fontSize: 13, color: "#666" }}>商品素材（{uploadFiles.length} 张）</Text>
        </div>
        <Space size={8} wrap>
          {uploadFiles.map((file) => (
            <div key={file.uid} style={{ width: 64, height: 64, borderRadius: 4, overflow: "hidden", border: "1px solid #e8e8e8" }}>
              <img src={file.thumbUrl || (file.originFileObj ? URL.createObjectURL(file.originFileObj) : "")} alt={file.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ))}
        </Space>
      </div>

      {/* 基本信息 */}
      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 8, padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <Text strong style={{ fontSize: 15, color: "#333" }}>商品信息</Text>
          <Space size={6}>
            <Button size="small" onClick={handleRegenerateAnalysis} loading={regenerating} disabled={!hasAnalysis}>AI 重新生成</Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={handleAnalyze} loading={analyzing}>{hasAnalysis ? "重新分析" : "开始分析"}</Button>
          </Space>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>商品名称</Text>
            <Input size="small" value={analysis.productName} onChange={(e) => updateAnalysisField("productName", e.target.value)} placeholder="商品名称" />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>商品类目</Text>
            <Input size="small" value={analysis.category} onChange={(e) => updateAnalysisField("category", e.target.value)} placeholder="商品类目" />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>材质</Text>
            <Input size="small" value={analysis.materials} onChange={(e) => updateAnalysisField("materials", e.target.value)} placeholder="材质" />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>颜色</Text>
            <Input size="small" value={analysis.colors} onChange={(e) => updateAnalysisField("colors", e.target.value)} placeholder="颜色" />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>尺寸</Text>
            <Input size="small" value={analysis.estimatedDimensions} onChange={(e) => updateAnalysisField("estimatedDimensions", e.target.value)} placeholder="尺寸" />
          </div>
        </div>
      </div>

      {/* 卖点/人群/场景 */}
      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 8, padding: "16px 20px" }}>
        <Text strong style={{ fontSize: 15, color: "#333", display: "block", marginBottom: 12 }}>营销信息</Text>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>核心卖点</Text>
            <TextArea autoSize={{ minRows: 5, maxRows: 10 }} value={arrayToMultiline(analysis.sellingPoints)} onChange={(event) => updateAnalysisField("sellingPoints", multilineToArray(event.target.value))} placeholder="一行一个卖点" style={{ fontSize: 13 }} />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>目标人群</Text>
            <TextArea autoSize={{ minRows: 5, maxRows: 10 }} value={arrayToMultiline(analysis.targetAudience)} onChange={(event) => updateAnalysisField("targetAudience", multilineToArray(event.target.value))} placeholder="一行一个目标人群" style={{ fontSize: 13 }} />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>使用场景</Text>
            <TextArea autoSize={{ minRows: 5, maxRows: 10 }} value={arrayToMultiline(analysis.usageScenes)} onChange={(event) => updateAnalysisField("usageScenes", multilineToArray(event.target.value))} placeholder="一行一个使用场景" style={{ fontSize: 13 }} />
          </div>
        </div>
      </div>

      {/* 生成设置 */}
      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 8, padding: "16px 20px" }}>
        <Text strong style={{ fontSize: 15, color: "#333", display: "block", marginBottom: 12 }}>生成设置</Text>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 14 }}>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>商品模式</Text>
            <Select size="small" value={productMode} onChange={setProductMode} options={PRODUCT_MODE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))} style={{ width: "100%" }} />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>文字语言</Text>
            <Select size="small" value={imageLanguage} onChange={setImageLanguage} options={IMAGE_LANGUAGE_OPTIONS as unknown as { value: string; label: string }[]} style={{ width: "100%" }} />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>画布尺寸</Text>
            <Select size="small" value={imageSize} onChange={setImageSize} options={IMAGE_SIZE_OPTIONS as unknown as { value: string; label: string }[]} style={{ width: "100%" }} />
          </div>
        </div>

        <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 8 }}>图片类型</Text>
        <Checkbox.Group
          style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
          value={selectedImageTypes}
          options={DEFAULT_IMAGE_TYPES.map((type) => ({ label: IMAGE_TYPE_LABELS[type], value: type }))}
          onChange={(values) => setSelectedImageTypes(values.map(String))}
        />
      </div>

      {/* 操作栏 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
        <Button size="small" onClick={() => setActiveStep(0)}>上一步</Button>
        <Button
          type="primary"
          icon={<RocketOutlined />}
          onClick={handleGeneratePlans}
          loading={planning}
          disabled={!hasAnalysis}
          style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}
        >
          生成出图方案
        </Button>
      </div>
    </Space>
  );

  const renderStepTwo = () => (
    <Card
      style={{
        borderRadius: TEMU_CARD_RADIUS,
        borderColor: "#eceff3",
        boxShadow: TEMU_CARD_SHADOW,
      }}
      bodyStyle={{ padding: 24 }}
    >
      <Space direction="vertical" size={18} style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <Title level={4} style={{ margin: 0, color: TEMU_TEXT }}>图片生成方案</Title>
            <Text type="secondary" style={{ display: "block", marginTop: 6 }}>
              AI 已根据商品分析生成每张图的方向，你可以直接确认，也可以继续微调描述。
            </Text>
          </div>
          <Space wrap>
            <Button onClick={() => setActiveStep(1)} style={{ borderRadius: 14 }}>上一步</Button>
            <Button onClick={handleGeneratePlans} loading={planning} disabled={!hasAnalysis} style={{ borderRadius: 14 }}>
              {hasPlans ? "重新生成方案" : "生成方案"}
            </Button>
            <Button
              type="primary"
              disabled={!hasPlans}
              onClick={() => setActiveStep(3)}
              style={{
                minWidth: 132,
                borderRadius: 14,
                border: "none",
                background: TEMU_BUTTON_GRADIENT,
                boxShadow: TEMU_BUTTON_SHADOW,
              }}
            >
              下一步
            </Button>
          </Space>
        </div>

        {plans.length > 0 ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {plans.map((plan, index) => (
              <div
                key={plan.imageType}
                style={{
                  border: "1px solid #eef1f4",
                  borderRadius: 18,
                  padding: 18,
                  background: "#ffffff",
                  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.05)",
                }}
              >
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <Space size={12} align="center">
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 999,
                          background: TEMU_BUTTON_GRADIENT,
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          boxShadow: "0 10px 18px rgba(255, 106, 0, 0.18)",
                        }}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <Text strong style={{ color: TEMU_TEXT }}>{IMAGE_TYPE_LABELS[plan.imageType] || plan.imageType}</Text>
                        <Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 2 }}>
                          {plan.title || plan.headline || "AI 自动方案"}
                        </Text>
                      </div>
                    </Space>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyText(plan.prompt, `${IMAGE_TYPE_LABELS[plan.imageType] || plan.imageType}方案已复制`)}
                      style={{ borderRadius: 12 }}
                    >
                      复制
                    </Button>
                  </div>
                  <Paragraph
                    style={{ marginBottom: 0, color: "#5f6b7c", whiteSpace: "pre-wrap" }}
                    ellipsis={{ rows: 2, expandable: true, symbol: "展开完整方案" }}
                  >
                    {plan.prompt}
                  </Paragraph>
                  <TextArea
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    value={plan.prompt}
                    onChange={(event) => updatePlanPrompt(plan.imageType, event.target.value)}
                    placeholder="这里可以手动微调每张图的 Prompt…"
                    style={{ borderRadius: 14 }}
                  />
                </Space>
              </div>
            ))}
          </Space>
        ) : (
          <Card style={{ borderRadius: 18, borderColor: "#edf0f4" }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先生成方案，再确认每张图的 Prompt" />
          </Card>
        )}
      </Space>
    </Card>
  );

  const renderGenerateStatusText = (status: string) => {
    if (status === "done") return "图片已生成，可在下方查看结果";
    if (status === "generating") return "正在生成图片，请稍候";
    if (status === "error") return "本张图片生成失败，可根据错误提示重试";
    return "等待开始生成";
  };

  const renderStepThree = () => (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      <Card
        style={{
          borderRadius: TEMU_CARD_RADIUS,
          borderColor: "#eceff3",
          boxShadow: TEMU_CARD_SHADOW,
        }}
        bodyStyle={{ padding: 24 }}
      >
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <Title level={4} style={{ margin: 0, color: TEMU_TEXT }}>生图进度</Title>
              <Text type="secondary" style={{ display: "block", marginTop: 6 }}>
                {generatedImages.length > 0
                  ? `当前已完成 ${successCount}/${planCount} 张图片，可以继续评分、保存和复制标题。`
                  : "方案确认后开始生成图片，并在下方查看完成结果。"}
              </Text>
            </div>
            <Space wrap>
              <Button onClick={() => setActiveStep(2)} disabled={generating} style={{ borderRadius: 14 }}>上一步</Button>
              <Button danger icon={<StopOutlined />} onClick={handleCancelGenerate} disabled={!generating || !currentJobId} style={{ borderRadius: 14 }}>
                取消任务
              </Button>
              <Button
                type="primary"
                icon={<RocketOutlined />}
                onClick={() => handleStartGenerate(false)}
                loading={generating}
                disabled={plans.length === 0 || uploadFiles.length === 0}
                style={{
                  minWidth: 144,
                  borderRadius: 14,
                  border: "none",
                  background: TEMU_BUTTON_GRADIENT,
                  boxShadow: TEMU_BUTTON_SHADOW,
                }}
              >
                {generating ? "生成中…" : "开始出图"}
              </Button>
              <Tooltip title="在后台生成，可以立即开始下一个商品">
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={() => handleStartGenerate(true)}
                  disabled={plans.length === 0 || uploadFiles.length === 0 || generating}
                  style={{ borderRadius: 14 }}
                >
                  后台生成
                </Button>
              </Tooltip>
            </Space>
          </div>

          <Progress percent={progressPercent} status={generating ? "active" : "normal"} strokeColor={TEMU_ORANGE} />

        </Space>
      </Card>

      {generatedImages.length > 0 ? (
        <>
          <Card
            style={{
              borderRadius: TEMU_CARD_RADIUS,
              borderColor: "#eceff3",
              boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)",
            }}
            bodyStyle={{ padding: 24 }}
          >
            <Space direction="vertical" size={18} style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Title level={4} style={{ margin: 0, color: TEMU_TEXT }}>图片结果</Title>
                <Space wrap>
                  <Tag color="success" style={{ borderRadius: 999, paddingInline: 12 }}>
                    已完成 {successCount}/{planCount}
                  </Tag>
                  <Button icon={<DownloadOutlined />} onClick={handleDownloadAllImages} loading={downloadingAll} style={{ borderRadius: 14 }}>
                    全部下载
                  </Button>
                </Space>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                {generatedImages.map((image) => {
                  const result = getResultState(results, image.imageType);
                  const variants = imageVariants[image.imageType] || [];
                  const activeVariant = variants.find((item) => item.variantId === activeVariantIds[image.imageType]) || variants[variants.length - 1];
                  const downloadKey = image.variantId || `${image.imageType}:${image.imageUrl}`;
                  return (
                    <Card
                      key={`${image.imageType}:${image.variantId || image.imageUrl}`}
                      size="small"
                      style={{
                        borderRadius: 18,
                        borderColor: "#eceff3",
                        boxShadow: "0 10px 26px rgba(15, 23, 42, 0.06)",
                        overflow: "hidden",
                      }}
                      bodyStyle={{ padding: 12 }}
                    >
                      <Space direction="vertical" size={12} style={{ width: "100%" }}>
                        <div style={{ position: "relative" }}>
                          <div
                            style={{
                              position: "absolute",
                              top: 10,
                              left: 10,
                              padding: "4px 10px",
                              borderRadius: 999,
                              background: "rgba(31, 35, 41, 0.66)",
                              color: "#fff",
                              fontSize: 12,
                              zIndex: 1,
                            }}
                          >
                            {IMAGE_TYPE_LABELS[image.imageType] || image.imageType}
                          </div>
                          <Image src={image.imageUrl} alt={image.imageType} style={{ width: "100%", borderRadius: 14, objectFit: "cover" }} />
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                          <Text strong style={{ color: TEMU_TEXT }}>{IMAGE_TYPE_LABELS[image.imageType] || image.imageType}</Text>
                          <Space size={8}>
                            <Button
                              size="small"
                              icon={<DownloadOutlined />}
                              onClick={() => handleDownloadImage(image)}
                              loading={Boolean(downloadingTypes[downloadKey])}
                              style={{ borderRadius: 12 }}
                            >
                              下载
                            </Button>
                            <Button
                              size="small"
                              icon={<StarOutlined />}
                              onClick={() => handleScoreImage(image.imageType, activeVariant?.variantId)}
                              loading={Boolean(activeVariant?.scoring)}
                              style={{ borderRadius: 12 }}
                            >
                              评分
                            </Button>
                          </Space>
                        </div>

                        {activeVariant?.score ? (
                          <Row gutter={[8, 8]}>
                            <Col span={8}><Statistic title="综合" value={activeVariant.score.overall} precision={1} /></Col>
                            <Col span={8}><Statistic title="合规" value={activeVariant.score.compliance} precision={1} /></Col>
                            <Col span={8}><Statistic title="吸引力" value={activeVariant.score.appeal} precision={1} /></Col>
                          </Row>
                        ) : null}

                        {activeVariant?.score?.suggestions?.length ? (
                          <Text type="secondary">优化建议：{activeVariant.score.suggestions.join("；")}</Text>
                        ) : null}

                        <div>
                          <Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                            重绘建议
                          </Text>
                          <TextArea
                            autoSize={{ minRows: 3, maxRows: 5 }}
                            value={redrawSuggestions[image.imageType] || ""}
                            onChange={(event) => setRedrawSuggestions((prev) => ({ ...prev, [image.imageType]: event.target.value }))}
                            placeholder="例如：背景改成厨房台面，不要人物，文案更简洁，整体更高级。"
                            style={{ borderRadius: 12 }}
                          />
                        </div>

                        <Button
                          block
                          icon={<ReloadOutlined />}
                          onClick={() => handleSingleRedraw(image.imageType)}
                          loading={Boolean(redrawingTypes[image.imageType])}
                          disabled={generating && !redrawingTypes[image.imageType]}
                          style={{ borderRadius: 12 }}
                        >
                          {redrawingTypes[image.imageType] ? "正在重绘…" : "按建议重绘"}
                        </Button>

                        {variants.length > 0 ? (
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}>
                              <Text type="secondary">候选版本</Text>
                              <Text type="secondary">{variants.length} 个</Text>
                            </div>
                            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                              {variants.map((variant, index) => {
                                const selected = activeVariant?.variantId === variant.variantId;
                                return (
                                  <button
                                    key={variant.variantId || `${variant.imageType}-${index}`}
                                    type="button"
                                    onClick={() => {
                                      setActiveVariantIds((prev) => ({ ...prev, [image.imageType]: variant.variantId || "" }));
                                      setRedrawSuggestions((prev) => ({ ...prev, [image.imageType]: variant.suggestion || "" }));
                                    }}
                                    style={{
                                      border: selected ? `2px solid ${TEMU_ORANGE}` : "1px solid #e5eaf1",
                                      borderRadius: 12,
                                      padding: 4,
                                      background: "#fff",
                                      cursor: "pointer",
                                      minWidth: 78,
                                    }}
                                  >
                                    <img
                                      src={variant.imageUrl}
                                      alt={`${image.imageType}-${index + 1}`}
                                      style={{ width: 68, height: 68, objectFit: "cover", borderRadius: 8, display: "block" }}
                                    />
                                    <div style={{ marginTop: 6, fontSize: 11, color: selected ? TEMU_ORANGE : "#7a8ca8" }}>
                                      {index === 0 ? "原图" : `候选 ${index}`}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {activeVariant?.suggestion ? (
                          <Text type="secondary">本候选调整：{activeVariant.suggestion}</Text>
                        ) : null}
                      </Space>
                    </Card>
                  );
                })}
              </div>
            </Space>
          </Card>

          <Card
            style={{
              borderRadius: TEMU_CARD_RADIUS,
              borderColor: "#eceff3",
              boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)",
            }}
            bodyStyle={{ padding: 24 }}
          >
            <Space direction="vertical" size={18} style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <Title level={4} style={{ margin: 0, color: TEMU_TEXT }}>商品标题</Title>
                  <Text type="secondary" style={{ display: "block", marginTop: 6 }}>
                    结合本次分析自动生成标题方案，支持直接复制到 Temu 或其他平台。
                  </Text>
                </div>
                <Button onClick={() => copyText(titleSuggestions.map((item) => `${item.label}：${item.text}`).join("\n\n"), "标题方案已全部复制")} style={{ borderRadius: 14 }}>
                  全部复制
                </Button>
              </div>

              <Space direction="vertical" size={14} style={{ width: "100%" }}>
                {titleSuggestions.map((item, index) => (
                  <div
                    key={item.key}
                    style={{
                      border: index === 1 ? "1px solid #ffb279" : "1px solid #edf0f4",
                      background: index === 1 ? "#fff8f2" : "#fff",
                      borderRadius: 18,
                      padding: 18,
                      boxShadow: index === 1 ? "0 10px 24px rgba(255, 106, 0, 0.08)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div>
                        <Tag color={index === 1 ? "orange" : "default"} style={{ borderRadius: 999, paddingInline: 12, marginBottom: 10 }}>
                          {item.label}
                        </Tag>
                        <Paragraph style={{ marginBottom: 10, color: TEMU_TEXT, fontSize: 15, lineHeight: 1.7 }}>
                          {item.text}
                        </Paragraph>
                        <Text type="secondary">{item.text.length} 字符</Text>
                      </div>
                      <Button
                        type="text"
                        icon={<CopyOutlined />}
                        onClick={() => copyText(item.text, `${item.label}已复制`)}
                        style={{ color: "#7a8ca8" }}
                      >
                        复制
                      </Button>
                    </div>
                  </div>
                ))}
              </Space>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  paddingTop: 4,
                }}
              >
                <Text type="secondary">不满意某一张图时，可以直接填写建议重绘，系统会保留原图并新增候选版本。</Text>
                <Space wrap>
                  <Button onClick={resetStudio} style={{ borderRadius: 14 }}>
                    重新开始
                  </Button>
                  <Button icon={<DownloadOutlined />} onClick={handleDownloadAllImages} loading={downloadingAll} style={{ borderRadius: 14 }}>
                    全部下载
                  </Button>
                </Space>
              </div>
            </Space>
          </Card>
        </>
      ) : (
        <Card style={{ borderRadius: TEMU_CARD_RADIUS, borderColor: "#eceff3" }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生成完成后，结果会在这里展示" />
        </Card>
      )}
    </Space>
  );

  const renderStepContent = () => {
    if (activeStep === 0) return renderStepZero();
    if (activeStep === 1) return renderStepOne();
    if (activeStep === 2) return renderStepTwo();
    return renderStepThree();
  };

  if (loading && !status.ready) {
    return (
      <div style={{ display: "flex", minHeight: 420, alignItems: "center", justifyContent: "center" }}>
        <Space direction="vertical" size={16} align="center">
          <Spin size="large" />
          <Text type="secondary">{status.message || "正在启动 AI 出图服务…"}</Text>
        </Space>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 22,
        padding: "4px 0 20px",
        background: TEMU_PAGE_BG,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <Title level={3} style={{ margin: 0, color: TEMU_TEXT, fontWeight: 700 }}>亚马逊商品图片生成器</Title>
          <Text type="secondary" style={{ display: "block", marginTop: 4, color: "#8a97ab" }}>
            AI 智能生成高转化率 Listing 图片
          </Text>
        </div>
        <Space size={10} wrap>
          <Button icon={<HistoryOutlined />} onClick={handleOpenHistory} style={{ height: 40, borderRadius: 16 }}>
            历史记录
          </Button>
          <Button icon={<SettingOutlined />} onClick={handleOpenConfig} loading={configLoading} style={{ height: 40, borderRadius: 16 }}>
            服务设置
          </Button>
        </Space>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {stepItems.map((item, index) => {
          const active = index === activeStep;
          const done = index < activeStep;
          const disabled = index > maxUnlockedStep;
          return (
            <Space key={item.title} size={12} align="center">
              <button
                type="button"
                onClick={() => handleStepChange(index)}
                disabled={disabled}
                style={{
                  height: 28,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: "none",
                  background: active ? TEMU_BUTTON_GRADIENT : done ? "#e9fff0" : "transparent",
                  color: active ? "#ffffff" : done ? "#16a34a" : "#93a1b4",
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  cursor: disabled ? "not-allowed" : "pointer",
                  boxShadow: active ? "0 8px 18px rgba(255, 106, 0, 0.2)" : "none",
                  opacity: disabled ? 0.6 : 1,
                  transition: "background-color 0.2s, color 0.2s, box-shadow 0.2s, opacity 0.2s",
                }}
              >
                {index + 1 + ". " + item.title}
              </button>
              {index < stepItems.length - 1 ? <div style={{ width: 30, height: 1, background: "#dbe3ee" }} /> : null}
            </Space>
          );
        })}
      </div>

      {!status.ready ? (
        <Card style={{ borderRadius: TEMU_CARD_RADIUS, borderColor: "#eceff3", boxShadow: TEMU_CARD_SHADOW }}>
          {status.status === "error" ? (
            <Space direction="vertical" size={16}>
              <Alert type="error" showIcon message="AI 出图服务启动失败" description={status.message} />
              <Space>
                <Button type="primary" icon={<ReloadOutlined />} onClick={() => refreshStatus(true)} loading={actionLoading}>重新启动</Button>
                <Button icon={<ExportOutlined />} onClick={handleOpenExternal}>浏览器打开</Button>
              </Space>
            </Space>
          ) : (
            <Space direction="vertical" size={16}>
              <Spin />
              <Text type="secondary">{status.message || "正在启动 AI 出图服务…"}</Text>
            </Space>
          )}
        </Card>
      ) : (
        <div style={{ maxWidth: 1120, margin: "0 auto", width: "100%" }}>
          {renderStepContent()}

          {/* 后台任务面板 */}
          {backgroundJobs.length > 0 && (
            <Card
              size="small"
              title={
                <Space>
                  <ThunderboltOutlined />
                  <span>后台生图任务</span>
                  <Tag>{backgroundJobs.filter(j => j.status === "running" || j.status === "pending").length} 进行中</Tag>
                </Space>
              }
              style={{ borderRadius: 12, marginTop: 16, borderColor: TEMU_BORDER }}
              extra={
                <Button
                  size="small"
                  onClick={() => {
                    const doneJobs = backgroundJobs.filter(j => j.status !== "running" && j.status !== "pending");
                    doneJobs.forEach(j => imageStudioAPI?.clearJob(j.jobId));
                    refreshBackgroundJobs();
                  }}
                  disabled={!backgroundJobs.some(j => j.status !== "running" && j.status !== "pending")}
                >
                  清除已完成
                </Button>
              }
            >
              <List
                size="small"
                dataSource={backgroundJobs}
                renderItem={(job: any) => {
                  const isRunning = job.status === "running" || job.status === "pending";
                  const isDone = job.status === "done";
                  const isFailed = job.status === "failed";
                  const statusTag = isDone
                    ? <Tag color="success">完成</Tag>
                    : isFailed
                      ? <Tag color="error">失败</Tag>
                      : job.status === "cancelled"
                        ? <Tag>已取消</Tag>
                        : <Tag color="processing">生成中 {job.progress?.done || 0}/{job.progress?.total || 0}</Tag>;

                  return (
                    <List.Item
                      actions={[
                        isRunning && (
                          <Button
                            key="cancel"
                            size="small"
                            danger
                            icon={<StopOutlined />}
                            onClick={() => imageStudioAPI?.cancelGenerate(job.jobId)}
                          >
                            取消
                          </Button>
                        ),
                        isDone && job.results?.length > 0 && (
                          <Button
                            key="view"
                            size="small"
                            type="link"
                            style={{ color: TEMU_ORANGE }}
                            onClick={async () => {
                              await loadHistory();
                              setHistoryOpen(true);
                            }}
                          >
                            查看历史
                          </Button>
                        ),
                      ].filter(Boolean)}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={8}>
                            <Text style={{ maxWidth: 200 }} ellipsis={{ tooltip: true }}>{job.productName || "未命名商品"}</Text>
                            {statusTag}
                          </Space>
                        }
                        description={
                          <Space size={4}>
                            <Text type="secondary" style={{ fontSize: 12 }}>{job.progress?.step || ""}</Text>
                            {isDone && job.historySaved ? <Text type="secondary" style={{ fontSize: 12 }}>已自动存入历史</Text> : null}
                            {isDone && job.historySaveError ? <Text type="danger" style={{ fontSize: 12 }}>{job.historySaveError}</Text> : null}
                            {isFailed && job.error && <Text type="danger" style={{ fontSize: 12 }}>{job.error}</Text>}
                          </Space>
                        }
                      />
                      {isRunning && (
                        <Progress
                          percent={job.progress?.total > 0 ? Math.round((job.progress.done / job.progress.total) * 100) : 0}
                          size="small"
                          style={{ width: 120 }}
                          strokeColor={TEMU_ORANGE}
                        />
                      )}
                    </List.Item>
                  );
                }}
              />
            </Card>
          )}
        </div>
      )}

      {false ? (
        <Row gutter={[20, 20]} style={{ maxWidth: 980, margin: "0 auto" }}>
          <Col xs={24} xl={activeStep === 0 ? 24 : 9}>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card
                title={activeStep === 0 ? null : `当前步骤 · ${stepItems[activeStep]?.title || "AI 出图"}`}
                style={{ borderRadius: 12, borderColor: TEMU_BORDER, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
                bodyStyle={activeStep === 0 ? { padding: 0 } : undefined}
              >
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  {activeStep !== 0 ? (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {stepItems[activeStep]?.description}
                    </Text>
                  ) : null}

                  {activeStep === 0 ? (
                    <>
                      <div
                        style={{
                          border: "1px dashed #ffb38a",
                          borderRadius: 24,
                          background: "radial-gradient(circle at top, #fffaf5 0%, #ffffff 70%)",
                          padding: "44px 24px 32px",
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: 12,
                            margin: "0 auto 18px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "linear-gradient(135deg, #ff7a1a 0%, #ff5a00 100%)",
                            boxShadow: "0 10px 24px rgba(255, 90, 0, 0.18)",
                          }}
                        >
                          <UploadOutlined style={{ color: "#fff", fontSize: 28 }} />
                        </div>

                        <Title level={4} style={{ marginBottom: 8 }}>拖拽商品图片到此处</Title>
                        <Text type="secondary">支持多张图片（最多 5 张），适合组合装/套装</Text>

                        <div style={{ marginTop: 24 }}>
                          <Upload
                            accept="image/*"
                            listType="picture"
                            multiple
                            beforeUpload={() => false}
                            fileList={uploadFiles}
                            maxCount={5}
                            onChange={({ fileList }) => setUploadFiles(fileList.slice(-5))}
                          >
                            <Button type="primary" size="large" icon={<UploadOutlined />} style={{ borderRadius: 8, minWidth: 132 }}>
                              选择图片
                            </Button>
                          </Upload>
                        </div>

                        <div style={{ marginTop: 18 }}>
                          <Text type="secondary">上传 1-5 张商品图，支持组合装/套装商品</Text>
                        </div>
                      </div>

                      <div style={{ padding: 24 }}>
                        <Space direction="vertical" size={18} style={{ width: "100%" }}>
                          <Row gutter={[12, 12]}>
                            <Col xs={24} md={12} xl={6}>
                              <Text type="secondary">商品模式</Text>
                              <Select
                                style={{ width: "100%", marginTop: 8 }}
                                value={productMode}
                                onChange={setProductMode}
                                options={PRODUCT_MODE_OPTIONS.map((option) => ({
                                  label: option.label,
                                  value: option.value,
                                }))}
                              />
                            </Col>
                            <Col xs={24} md={12} xl={6}>
                              <Text type="secondary">销售区域</Text>
                              <Select
                                style={{ width: "100%", marginTop: 8 }}
                                value={salesRegion}
                                onChange={(value) => {
                                  setSalesRegion(value);
                                  setImageLanguage(getDefaultImageLanguageForRegion(value));
                                }}
                                options={SALES_REGION_OPTIONS as unknown as { value: string; label: string }[]}
                              />
                            </Col>
                            <Col xs={24} md={12} xl={6}>
                              <Text type="secondary">文字语言</Text>
                              <Select
                                style={{ width: "100%", marginTop: 8 }}
                                value={imageLanguage}
                                onChange={setImageLanguage}
                                options={IMAGE_LANGUAGE_OPTIONS as unknown as { value: string; label: string }[]}
                              />
                            </Col>
                            <Col xs={24} md={12} xl={6}>
                              <Text type="secondary">画布尺寸</Text>
                              <Select
                                style={{ width: "100%", marginTop: 8 }}
                                value={imageSize}
                                onChange={setImageSize}
                                options={IMAGE_SIZE_OPTIONS as unknown as { value: string; label: string }[]}
                              />
                            </Col>
                          </Row>

                          <div>
                            <Text type="secondary">需要生成的图片类型</Text>
                            <Checkbox.Group
                              style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 14 }}
                              value={selectedImageTypes}
                              options={DEFAULT_IMAGE_TYPES.map((type) => ({ label: IMAGE_TYPE_LABELS[type], value: type }))}
                              onChange={(values) => setSelectedImageTypes(values.map(String))}
                            />
                          </div>

                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <Space wrap size={[8, 8]}>
                              {selectedTypeLabels.map((label) => (
                                <Tag key={label} color="orange" style={{ borderRadius: 8 }}>{label}</Tag>
                              ))}
                            </Space>
                            <Button type="primary" size="large" style={{ borderRadius: 8, minWidth: 144 }} disabled={!hasUploads} onClick={() => setActiveStep(1)}>
                              下一步
                            </Button>
                          </div>
                        </Space>
                      </div>
                    </>
                  ) : (
                    <>
                      <Space wrap size={[8, 8]}>
                        <Tag color="orange">素材 {uploadFiles.length} 张</Tag>
                        <Tag>{selectedTypeLabels.length || 0} 种图类型</Tag>
                        <Tag>{SALES_REGION_OPTIONS.find((option) => option.value === salesRegion)?.label || salesRegion}</Tag>
                        <Tag>{IMAGE_LANGUAGE_OPTIONS.find((option) => option.value === imageLanguage)?.label || imageLanguage}</Tag>
                        <Tag>{imageSize}</Tag>
                      </Space>

                      <Space direction="vertical" size={10} style={{ width: "100%" }}>
                        <Button block onClick={() => setActiveStep(Math.max(activeStep - 1, 0))}>上一步</Button>
                        {activeStep === 1 ? (
                          <>
                            <Button block type="primary" icon={<PictureOutlined />} onClick={handleAnalyze} loading={analyzing}>
                              {hasAnalysis ? "重新分析商品" : "开始分析商品"}
                            </Button>
                            <Button block icon={<ReloadOutlined />} onClick={handleRegenerateAnalysis} loading={regenerating} disabled={!hasAnalysis}>
                              {regenerating ? "重生中…" : "重生卖点"}
                            </Button>
                            <Button block type="primary" disabled={!hasAnalysis} onClick={() => setActiveStep(2)}>
                              下一步：生成方案
                            </Button>
                          </>
                        ) : null}
                        {activeStep === 2 ? (
                          <>
                            <Button block type="primary" icon={<RocketOutlined />} onClick={handleGeneratePlans} loading={planning} disabled={!hasAnalysis}>
                              {planning ? "生成中…" : hasPlans ? "重新生成方案" : "生成方案"}
                            </Button>
                            <Button block type="primary" disabled={!hasPlans} onClick={() => setActiveStep(3)}>
                              下一步：开始出图
                            </Button>
                          </>
                        ) : null}
                        {activeStep === 3 ? (
                          <>
                            <Button
                              block
                              type="primary"
                              icon={<RocketOutlined />}
                              onClick={() => handleStartGenerate(false)}
                              loading={generating}
                              disabled={plans.length === 0 || uploadFiles.length === 0}
                            >
                              {generating ? "正在生图…" : "开始原生生图"}
                            </Button>
                            <Button block icon={<ThunderboltOutlined />} onClick={() => handleStartGenerate(true)} disabled={plans.length === 0 || uploadFiles.length === 0 || generating}>
                              后台生成
                            </Button>
                            <Button block danger icon={<StopOutlined />} onClick={handleCancelGenerate} disabled={!generating || !currentJobId}>
                              取消任务
                            </Button>
                          </>
                        ) : null}
                      </Space>
                    </>
                  )}
                </Space>
              </Card>
            </Space>
          </Col>

          {activeStep !== 0 ? (
          <Col xs={24} xl={15}>
            {activeStep === 1 ? (
              <Card title="确认商品分析">
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  {!hasAnalysis ? (
                    <Text type="secondary">先点左侧“开始分析商品”，这里会自动填充商品信息。</Text>
                  ) : null}

                  <Input value={analysis.productName} onChange={(event) => updateAnalysisField("productName", event.target.value)} placeholder="商品名称" />
                  <Row gutter={12}>
                    <Col span={12}>
                      <Input value={analysis.category} onChange={(event) => updateAnalysisField("category", event.target.value)} placeholder="商品类目" />
                    </Col>
                    <Col span={12}>
                      <Input value={analysis.estimatedDimensions} onChange={(event) => updateAnalysisField("estimatedDimensions", event.target.value)} placeholder="尺寸信息" />
                    </Col>
                  </Row>
                  <Input value={analysis.materials} onChange={(event) => updateAnalysisField("materials", event.target.value)} placeholder="材质" />
                  <Input value={analysis.colors} onChange={(event) => updateAnalysisField("colors", event.target.value)} placeholder="颜色 / 色值" />
                  <Row gutter={12}>
                    <Col xs={24} xxl={8}>
                      <Text type="secondary">卖点</Text>
                      <TextArea
                        autoSize={{ minRows: 4, maxRows: 10 }}
                        value={arrayToMultiline(analysis.sellingPoints)}
                        onChange={(event) => updateAnalysisField("sellingPoints", multilineToArray(event.target.value))}
                        placeholder="一行一个卖点"
                      />
                    </Col>
                    <Col xs={24} xxl={8}>
                      <Text type="secondary">目标人群</Text>
                      <TextArea
                        autoSize={{ minRows: 4, maxRows: 10 }}
                        value={arrayToMultiline(analysis.targetAudience)}
                        onChange={(event) => updateAnalysisField("targetAudience", multilineToArray(event.target.value))}
                        placeholder="一行一个人群"
                      />
                    </Col>
                    <Col xs={24} xxl={8}>
                      <Text type="secondary">使用场景</Text>
                      <TextArea
                        autoSize={{ minRows: 4, maxRows: 10 }}
                        value={arrayToMultiline(analysis.usageScenes)}
                        onChange={(event) => updateAnalysisField("usageScenes", multilineToArray(event.target.value))}
                        placeholder="一行一个场景"
                      />
                    </Col>
                  </Row>
                </Space>
              </Card>
            ) : null}

            {activeStep === 2 ? (
              <Card title="确认出图方案">
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  {plans.length > 0 ? (
                    <List
                      size="small"
                      dataSource={plans}
                      renderItem={(plan) => (
                        <List.Item>
                          <Space direction="vertical" size={10} style={{ width: "100%" }}>
                            <Space style={{ justifyContent: "space-between", width: "100%" }} wrap>
                              <Tag color="blue">{IMAGE_TYPE_LABELS[plan.imageType] || plan.imageType}</Tag>
                              <Text type="secondary">{plan.title || plan.headline || "自动方案"}</Text>
                            </Space>
                            <TextArea
                              autoSize={{ minRows: 4, maxRows: 10 }}
                              value={plan.prompt}
                              onChange={(event) => updatePlanPrompt(plan.imageType, event.target.value)}
                              placeholder="这里可以手动微调每张图的 Prompt"
                            />
                          </Space>
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Text type="secondary">点左侧“生成方案”后，这里会列出每张图的 Prompt。</Text>
                  )}
                </Space>
              </Card>
            ) : null}

            {activeStep === 3 ? (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Card
                  title="执行出图任务"
                  extra={<Space><Tag color={generating ? "processing" : "default"}>{generating ? "生成中" : "空闲"}</Tag><Text type="secondary">{completedCount}/{planCount}</Text></Space>}
                >
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Progress percent={progressPercent} status={generating ? "active" : "normal"} />

                    {plans.length > 0 ? (
                      <List
                        size="small"
                        bordered
                        dataSource={plans}
                        renderItem={(plan) => {
                          const result = getResultState(results, plan.imageType);
                          return (
                            <List.Item>
                              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                  <Space>
                                    <Tag color="blue">{IMAGE_TYPE_LABELS[plan.imageType] || plan.imageType}</Tag>
                                    {result.status === "queued" ? <Tag>排队中</Tag> : null}
                                    {result.status === "done" ? <Tag color="success">已完成</Tag> : null}
                                    {result.status === "generating" ? <Tag color="processing">生成中</Tag> : null}
                                    {result.status === "error" ? <Tag color="error">失败</Tag> : null}
                                  </Space>
                                  <Text type="secondary">{plan.title || plan.headline || "自动方案"}</Text>
                                </div>
                                <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }} ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}>
                                  {plan.prompt}
                                </Paragraph>
                                {result.warnings.length > 0 ? (
                                  <Text type="secondary">注意：{result.warnings.join("；")}</Text>
                                ) : null}
                                {result.error ? (
                                  <Text type="danger">{result.error}</Text>
                                ) : null}
                              </Space>
                            </List.Item>
                          );
                        }}
                      />
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有出图方案，请先回到上一步生成方案" />
                    )}
                  </Space>
                </Card>

                {generatedImages.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
                    {generatedImages.map((image) => {
                      const result = getResultState(results, image.imageType);
                      return (
                        <Card
                          key={image.imageType}
                          size="small"
                          title={IMAGE_TYPE_LABELS[image.imageType] || image.imageType}
                          extra={<Button size="small" icon={<StarOutlined />} onClick={() => handleScoreImage(image.imageType)} loading={result.scoring}>评分</Button>}
                        >
                          <Space direction="vertical" size={12} style={{ width: "100%" }}>
                            <Image src={image.imageUrl} alt={image.imageType} style={{ width: "100%", borderRadius: 8, objectFit: "cover" }} />
                            {result.score ? (
                              <Row gutter={[8, 8]}>
                                <Col span={8}><Statistic title="综合" value={result.score.overall} precision={1} /></Col>
                                <Col span={8}><Statistic title="合规" value={result.score.compliance} precision={1} /></Col>
                                <Col span={8}><Statistic title="吸引力" value={result.score.appeal} precision={1} /></Col>
                              </Row>
                            ) : null}
                            {result.score?.suggestions?.length ? (
                              <Text type="secondary">优化建议：{result.score.suggestions.join("；")}</Text>
                            ) : null}
                          </Space>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <Card>
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生成完成后，结果会在这里原生展示" />
                  </Card>
                )}
              </Space>
            ) : null}

            {activeStep === 0 ? (
              <Card title="本次出图">
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <div>
                    <Text type="secondary">图片类型</Text>
                    <div style={{ marginTop: 10 }}>
                      <Space wrap size={[8, 8]}>
                        {selectedTypeLabels.map((label) => (
                          <Tag key={label} color="orange">{label}</Tag>
                        ))}
                      </Space>
                    </div>
                  </div>

                  <div>
                    <Text type="secondary">已上传素材</Text>
                    <div style={{ marginTop: 10 }}>
                      {uploadFiles.length > 0 ? (
                        <Space direction="vertical" size={8} style={{ width: "100%" }}>
                          {uploadFiles.map((file) => (
                            <div
                              key={file.uid}
                              style={{
                                padding: "12px 14px",
                                border: `1px solid ${TEMU_BORDER}`,
                                borderRadius: 14,
                                background: "#fff",
                              }}
                            >
                              <Text>{file.name}</Text>
                            </div>
                          ))}
                        </Space>
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传后的素材会显示在这里" />
                      )}
                    </div>
                  </div>
                </Space>
              </Card>
            ) : null}
          </Col>
          ) : null}
        </Row>
      ) : null}

      <Drawer
        title="AI 出图配置"
        width={480}
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        extra={<Button type="primary" onClick={handleSaveConfig} loading={configLoading}>保存配置</Button>}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Input value={configDraft.analyzeModel} onChange={(event) => setConfigDraft((prev) => ({ ...prev, analyzeModel: event.target.value }))} placeholder={config.analyzeModel || "分析模型"} />
          <Input.Password value={configDraft.analyzeApiKey} onChange={(event) => setConfigDraft((prev) => ({ ...prev, analyzeApiKey: event.target.value }))} placeholder={hasMaskedValue(config.analyzeApiKey) ? "已配置分析 API Key，如需更新请重新输入" : "分析 API Key"} />
          <Input value={configDraft.analyzeBaseUrl} onChange={(event) => setConfigDraft((prev) => ({ ...prev, analyzeBaseUrl: event.target.value }))} placeholder={config.analyzeBaseUrl || "分析 Base URL"} />
          <Input value={configDraft.generateModel} onChange={(event) => setConfigDraft((prev) => ({ ...prev, generateModel: event.target.value }))} placeholder={config.generateModel || "出图模型"} />
          <Input.Password value={configDraft.generateApiKey} onChange={(event) => setConfigDraft((prev) => ({ ...prev, generateApiKey: event.target.value }))} placeholder={hasMaskedValue(config.generateApiKey) ? "已配置出图 API Key，如需更新请重新输入" : "出图 API Key"} />
          <Input value={configDraft.generateBaseUrl} onChange={(event) => setConfigDraft((prev) => ({ ...prev, generateBaseUrl: event.target.value }))} placeholder={config.generateBaseUrl || "出图 Base URL"} />
        </Space>
      </Drawer>

      <Drawer title="历史记录" width={420} open={historyOpen} onClose={() => setHistoryOpen(false)}>
        {historyLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}><Spin /></div>
        ) : historyItems.length > 0 ? (
          <List
            itemLayout="vertical"
            dataSource={historyItems}
            renderItem={(item) => (
              <List.Item
                key={item.id}
                actions={[<Button key="load" type="link" onClick={() => handleLoadHistoryItem(item)}>加载结果</Button>]}
              >
                <List.Item.Meta
                  title={item.productName}
                  description={`${item.imageCount} 张图片 · ${item.salesRegion.toUpperCase()} · ${formatTimestamp(item.timestamp)}`}
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有历史记录" />
        )}
      </Drawer>
    </div>
  );
}
