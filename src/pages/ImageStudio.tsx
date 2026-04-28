import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Image,
  Input,
  InputNumber,
  List,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import {
  CheckCircleOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExportOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RocketOutlined,
  StarOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useLocation } from "react-router-dom";
import {
  DEFAULT_IMAGE_TYPES,
  EMPTY_IMAGE_STUDIO_ANALYSIS,
  IMAGE_LANGUAGE_OPTIONS,
  IMAGE_TYPE_LABELS,
  PRODUCT_MODE_OPTIONS,
  formatTimestamp,
  getDefaultImageLanguageForRegion,
  normalizeImageStudioAnalysis,
  type ImageStudioAnalysis,
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
const TEMU_TEXT = "#1f2329";
const TEMU_CARD_RADIUS = 22;
const TEMU_CARD_SHADOW = "0 12px 30px rgba(15, 23, 42, 0.08)";
const TEMU_BUTTON_GRADIENT = "linear-gradient(135deg, #ff922b 0%, #ff6a00 100%)";
const TEMU_BUTTON_SHADOW = "0 10px 24px rgba(255, 106, 0, 0.24)";
const TEMU_UPLOAD_BG = "radial-gradient(circle at top, #fff9f3 0%, #ffffff 72%)";
const IMAGE_STUDIO_FAST_MAX_SIDE = 1600;
const IMAGE_STUDIO_FAST_RAW_BYTES = 2.5 * 1024 * 1024;
const IMAGE_STUDIO_FAST_QUALITY = 0.88;
const PLAN_DISPLAY_SUBTITLES: Record<string, string> = {
  main: "主图方案",
  features: "卖点方案",
  closeup: "细节方案",
  dimensions: "尺寸方案",
  lifestyle: "场景方案",
  packaging: "包装方案",
  comparison: "对比方案",
  lifestyle2: "A+ 收束方案",
  scene_a: "核价场景方案 A",
  scene_b: "核价场景方案 B",
};
const REDRAW_UI_TEXT = {
  score: "\u8bc4\u5206",
  redraw: "\u5355\u5f20\u91cd\u7ed8",
  download: "\u4e0b\u8f7d",
  redrawTitle: "\u5f53\u524d\u8fd9\u5f20\u56fe\u7684\u91cd\u7ed8\u5efa\u8bae",
  redrawPlaceholder: "\u4f8b\u5982\uff1a\u6539\u6210\u53a8\u623f\u53f0\u9762\uff0c\u4e0d\u8981\u4eba\u7269\uff0c\u753b\u9762\u66f4\u7b80\u6d01",
  directRedraw: "\u76f4\u63a5\u91cd\u7ed8",
  guidedRedraw: "\u5e26\u63d0\u793a\u91cd\u7ed8",
  helper: "\u6bcf\u5f20\u56fe\u90fd\u53ef\u4ee5\u5355\u72ec\u91cd\u7ed8\u3002\u70b9\u51fb\u67d0\u4e00\u5f20\u56fe\u7247\u4e0a\u7684\u91cd\u7ed8\u6309\u94ae\uff0c\u53ea\u4f1a\u91cd\u7ed8\u5f53\u524d\u8fd9\u5f20\uff0c\u5e76\u4fdd\u7559\u539f\u56fe\u65b0\u589e\u5019\u9009\u7248\u672c\u3002",
  needSuggestion: "\u5148\u8f93\u5165\u4f60\u7684\u4fee\u6539\u5efa\u8bae\uff0c\u518d\u91cd\u7ed8\u8fd9\u5f20\u56fe",
  redrawStarted: "\u5df2\u5f00\u59cb\u91cd\u7ed8",
} as const;

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

type ImageStudioEventPayloadLike = {
  type?: string;
  jobId?: string;
  event?: {
    imageType?: string;
    status?: string;
    imageUrl?: string;
    error?: string;
    warnings?: string[];
  };
  results?: ImageStudioGeneratedImage[];
  error?: string;
  message?: string;
  historySaved?: boolean;
  historyId?: string | null;
  historySaveError?: string | null;
};

type ImageStudioHistorySourceFile = {
  name?: string;
  type?: string;
  dataUrl: string;
};

type RedrawJobMeta = {
  imageType: string;
  suggestion: string;
  prompt: string;
};

type ImageStudioLocationState = {
  prefill?: {
    title?: string;
    category?: string;
    imageUrl?: string;
    skcId?: string;
  };
};

type MarketingInfoField = "sellingPoints" | "targetAudience" | "usageScenes";

const EMPTY_MARKETING_TRANSLATING_STATE: Record<MarketingInfoField, boolean> = {
  sellingPoints: false,
  targetAudience: false,
  usageScenes: false,
};

function containsChineseText(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

function containsLatinText(value: string) {
  return /[A-Za-z]/.test(value);
}

function hasMarketingTranslation(value: string) {
  if (!containsChineseText(value) || !containsLatinText(value)) {
    return false;
  }
  return /[\uFF08(][^\uFF08\uFF09()]*[A-Za-z][^\uFF08\uFF09()]*[\uFF09)]\s*$/.test(value.trim());
}

function mergeMarketingTranslation(original: string, translated: string) {
  const source = original.trim();
  const english = translated.trim();

  if (!source || !english || source === english || hasMarketingTranslation(source)) {
    return source;
  }

  if (!containsChineseText(source)) {
    return english;
  }

  return `${source} (${english})`;
}

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

export function _flattenVariantMap(variantMap: ImageVariantMap, selectedTypes: string[], activeVariantIds: Record<string, string>) {
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

function buildDirectRedrawPrompt(basePrompt: string, imageType: string) {
  return [
    basePrompt.trim(),
    "",
    `\u8bf7\u57fa\u4e8e\u540c\u4e00\u4e2a\u5546\u54c1\u548c\u540c\u4e00\u4e2a\u51fa\u56fe\u76ee\u6807\uff0c\u76f4\u63a5\u91cd\u7ed8\u8fd9\u5f20${IMAGE_TYPE_LABELS[imageType] || imageType}\u3002`,
    "\u4fdd\u7559\u5546\u54c1\u4e3b\u4f53\u3001\u5e73\u53f0\u5408\u89c4\u8981\u6c42\u548c\u6574\u4f53\u5356\u70b9\u65b9\u5411\u3002",
    "\u8bf7\u7528\u66f4\u65b0\u7684\u6784\u56fe\u3001\u89c6\u89d2\u3001\u9053\u5177\u548c\u753b\u9762\u5904\u7406\u65b9\u5f0f\uff0c\u751f\u6210 1 \u5f20\u65b0\u7684\u5019\u9009\u7248\u672c\u3002",
  ].join("\n");
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
  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trim()}...`;
}

function normalizeProductDisplayName(value?: string | null) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const withoutAsciiParen = normalized.replace(
    /\s*[（(]\s*[A-Za-z0-9][A-Za-z0-9\s\-–—,./&+'"]{0,120}\s*[)）]\s*$/,
    "",
  ).trim();

  const primarySegment = withoutAsciiParen
    .split(/\s+[|｜]\s+/)[0]
    .split(/\s+\/\s+/)[0]
    .trim();

  return primarySegment || withoutAsciiParen || normalized;
}

function sanitizeTitleFragment(
  value?: string | null,
  options: { keepMeasurements?: boolean } = {},
) {
  let normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  normalized = normalized
    .replace(/[（(][^（）()]*#(?:[0-9A-Fa-f]{3,8})[^（）()]*[）)]/g, "")
    .replace(/[（(][^（）()]*[A-Za-z][^（）()]*[）)]/g, "")
    .replace(/~?\s*#(?:[0-9A-Fa-f]{3,8})\b/g, "")
    .replace(/\s*\/\s*\d+(?:\.\d+)?\s*(?:in|inch|inches)\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:in|inch|inches)\b/gi, "")
    .replace(/[（(]([\u3400-\u9fff0-9A-Za-z\s.+-]{1,24})[）)]/g, " $1 ")
    .replace(/(\d+(?:\.\d+)?)\s*(cm|mm|m|kg|g|ml|l)\b/gi, (_match, amount, unit) => `${amount}${String(unit).toLowerCase()}`)
    .replace(/\s*[|｜/／;；]+\s*/g, "，")
    .replace(/\s*,\s*/g, "，")
    .replace(/\s+/g, " ")
    .trim();

  if (!options.keepMeasurements) {
    normalized = normalized.replace(/\b\d+(?:\.\d+)?(?:cm|mm|m|kg|g|ml|l)\b/gi, "");
  }

  return normalized
    .replace(/^[，、,\s]+|[，、,\s]+$/g, "")
    .replace(/，{2,}/g, "，")
    .trim();
}

function dedupeTitleSegments(values: Array<string | null | undefined>) {
  const result: string[] = [];
  for (const rawValue of values) {
    if (typeof rawValue !== "string") continue;
    const value = rawValue.trim();
    if (!value) continue;
    if (result.some((current) => current === value || current.includes(value) || value.includes(current))) {
      continue;
    }
    result.push(value);
  }
  return result;
}

function extractTitleSegments(
  value?: string | null,
  options: { keepMeasurements?: boolean; maxItems?: number } = {},
) {
  const normalized = sanitizeTitleFragment(value, options);
  if (!normalized) return [];

  const segments = dedupeTitleSegments(
    normalized
      .split(/[，,、]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => containsChineseText(item) || (options.keepMeasurements && /\d+(?:\.\d+)?(?:cm|mm|m|kg|g|ml|l)/i.test(item)))
      .filter((item) => !/^[A-Za-z][A-Za-z0-9&+\-./'\s]{2,}$/.test(item)),
  );

  return typeof options.maxItems === "number" ? segments.slice(0, options.maxItems) : segments;
}

function joinTitleSegments(values: string[], maxLength: number) {
  return trimTitle(
    dedupeTitleSegments(values)
      .filter(Boolean)
      .join("，")
      .replace(/，{2,}/g, "，")
      .replace(/^[，、]+|[，、]+$/g, "")
      .trim(),
    maxLength,
  );
}

function buildTitleSuggestions(analysis: ImageStudioAnalysis) {
  const productName = sanitizeTitleFragment(normalizeProductDisplayName(analysis.productName), { keepMeasurements: true })
    || extractTitleSegments(analysis.category, { maxItems: 1 })[0]
    || "商品";
  const materials = extractTitleSegments(analysis.materials, { maxItems: 2 });
  const colors = extractTitleSegments(analysis.colors, { maxItems: 2 });
  const sizes = extractTitleSegments(analysis.estimatedDimensions, { keepMeasurements: true, maxItems: 2 });
  const sellingPoints = dedupeTitleSegments(
    dedupeTextList(analysis.sellingPoints)
      .flatMap((item) => extractTitleSegments(item, { keepMeasurements: true, maxItems: 2 })),
  ).slice(0, 4);

  const keywordFocused = joinTitleSegments(
    [productName, ...materials, ...colors, ...sizes, ...sellingPoints.slice(0, 2)],
    110,
  );
  const benefitFocused = joinTitleSegments(
    [productName, ...sellingPoints, ...sizes.slice(0, 1), ...materials.slice(0, 1)],
    90,
  );
  const conciseFocused = joinTitleSegments(
    [productName, sellingPoints[0] || materials[0], colors[0] || sizes[0]],
    65,
  );

  return [
    { key: "keywords", label: "关键词优化版", text: keywordFocused },
    { key: "benefits", label: "卖点突出版", text: benefitFocused },
    { key: "concise", label: "简洁精炼版", text: conciseFocused },
  ];
}

type BilingualPlanPreview = {
  goal: string;
  highlights: string[];
};

function getImageTypeSummaryHint(imageType: string) {
  if (imageType === "main") return "主图优先突出商品主体、质感和第一眼识别度。";
  if (imageType === "features") return "卖点图重点讲清核心功能，但不要把画面堆得太满。";
  if (imageType === "closeup") return "细节图重点放大材质、做工和结构细节。";
  if (imageType === "dimensions") return "尺寸图优先保证比例清楚、标注可读。";
  if (imageType === "lifestyle" || imageType === "lifestyle2") return "场景图要贴近日常使用环境，强化代入感。";
  if (imageType === "packaging") return "包装图要交代包装完整度和开箱感受。";
  if (imageType === "comparison") return "对比图要突出差异点，但不要做误导性夸张。";
  if (imageType === "scene_a" || imageType === "scene_b") return "场景图要稳定表达核心卖点和使用氛围。";
  return "";
}

function buildBilingualPlanPreview(
  plan: ImageStudioPlan,
  options: {
    productName?: string;
    regionLabel?: string;
    languageLabel?: string;
  } = {},
): BilingualPlanPreview {
  const prompt = plan.prompt || "";
  const imageTypeLabel = IMAGE_TYPE_LABELS[plan.imageType] || plan.imageType || "商品图";
  const productName = normalizeProductDisplayName(options.productName) || plan.headline?.trim() || plan.title?.trim() || "当前商品";
  const regionLabel = options.regionLabel?.trim();
  const languageLabel = options.languageLabel?.trim();

  const highlights = dedupeTextList([
    getImageTypeSummaryHint(plan.imageType),
    /ALL text on the image MUST be in ENGLISH/i.test(prompt)
      ? "图片中的文案统一使用英文，避免中英混排。"
      : languageLabel
        ? `当前方案会按 ${languageLabel} 输出画面文案。`
        : "",
    /CLEAN CORNERS RULE|corner icon|all four corners/i.test(prompt)
      ? "四角保持干净，不要水印、Logo、印章或角标装饰。"
      : "",
    /PRODUCT IDENTITY RULE|real retail product|practical identity/i.test(prompt)
      ? "商品必须真实还原用途和结构，不要改成抽象摆件或错误品类。"
      : "",
    /PRODUCT LABEL TEXT|LETTER-PERFECT|Brand name|verify against the reference photo/i.test(prompt)
      ? "品牌名、标签文字和关键信息要逐字准确，宁可弱化也不要写错。"
      : "",
    /FRAMING & CROPPING|ENTIRE product|crop or cut off|padding/i.test(prompt)
      ? "商品主体需要完整入镜，并预留安全边距，避免被裁切。"
      : "",
    /60-80%/i.test(prompt) ? "主体占画面约 60% 到 80%，既突出又保留呼吸感。" : "",
    /5%\s+padding|at least 5% padding/i.test(prompt) ? "四周至少预留 5% 边距，避免贴边。": "",
    /multi-panel|panel layout/i.test(prompt) ? "如果采用分栏布局，每个分栏都要保证信息清晰且不拥挤。" : "",
  ]).slice(0, 6);

  const goal = regionLabel
    ? `为「${productName}」生成适配 ${regionLabel} 市场的${imageTypeLabel}方案，重点兼顾平台合规、主体清晰度和转化表达。`
    : `为「${productName}」生成${imageTypeLabel}方案，重点兼顾平台合规、主体清晰度和转化表达。`;

  return {
    goal,
    highlights,
  };
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
  const location = useLocation();
  const [status, setStatus] = useState<ImageStudioStatus>(FALLBACK_STATUS);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<ImageStudioHistorySummary[]>([]);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [productMode, setProductMode] = useState("single");
  const [salesRegion, setSalesRegion] = useState("us");
  const [imageLanguage, setImageLanguage] = useState(getDefaultImageLanguageForRegion("us"));
  const [imageSize] = useState("800x800");
  const [selectedImageTypes, setSelectedImageTypes] = useState<string[]>(DEFAULT_IMAGE_TYPES);
  // 套装件数（1 = 单件，2 = 2pc, 3 = 3pc ...），控制出图里展示几件相同商品同框
  const [packCount, setPackCount] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const saved = Number(window.localStorage?.getItem("image_studio_pack_count") || "1");
    return Number.isFinite(saved) && saved >= 1 && saved <= 12 ? saved : 1;
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("image_studio_pack_count", String(packCount));
    }
  }, [packCount]);
  const [analysis, setAnalysis] = useState<ImageStudioAnalysis>(EMPTY_IMAGE_STUDIO_ANALYSIS);
  const [plans, setPlans] = useState<ImageStudioPlan[]>([]);
  const [results, setResults] = useState<ResultStateMap>({});
  const [imageVariants, setImageVariants] = useState<ImageVariantMap>({});
  const [activeVariantIds, setActiveVariantIds] = useState<Record<string, string>>({});
  const [redrawSuggestions, setRedrawSuggestions] = useState<Record<string, string>>({});
  const [openRedrawComposerFor, setOpenRedrawComposerFor] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadingTypes, setDownloadingTypes] = useState<Record<string, boolean>>({});
  const [redrawingTypes, setRedrawingTypes] = useState<Record<string, boolean>>({});
  const [translatingFields, setTranslatingFields] = useState<Record<MarketingInfoField, boolean>>(EMPTY_MARKETING_TRANSLATING_STATE);
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
  const redrawJobsRef = useRef<Record<string, RedrawJobMeta>>({});
  const appliedPrefillRef = useRef("");

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

  useEffect(() => {
    const routeState = location.state as ImageStudioLocationState | null;
    const prefill = routeState?.prefill;
    const signature = [prefill?.skcId, prefill?.title, prefill?.category].filter(Boolean).join("|");

    if (!prefill || !signature || appliedPrefillRef.current === signature) {
      return;
    }

    appliedPrefillRef.current = signature;
    setAnalysis((prev) => ({
      ...prev,
      productName: prefill.title || prev.productName,
      category: prefill.category || prev.category,
    }));

    if (prefill.title || prefill.category) {
      message.success("已带入商品信息，可直接继续 AI 出图");
    }
  }, [location.state]);

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

  const refreshBackgroundJobs = async () => {
    if (!imageStudioAPI) return;
    try {
      const jobs = await imageStudioAPI.listJobs();
      setBackgroundJobs(Array.isArray(jobs) ? jobs : []);
    } catch (error) {
      // 后台任务轮询失败不影响前台生成流程
      console.warn("[ImageStudio] refreshBackgroundJobs failed", error);
    }
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

  const clearRedrawJob = (jobId?: string) => {
    if (!jobId) return null;
    const redrawMeta = redrawJobsRef.current[jobId];
    if (!redrawMeta) return null;
    const nextJobs = { ...redrawJobsRef.current };
    delete nextJobs[jobId];
    redrawJobsRef.current = nextJobs;
    setRedrawingTypes((prev) => ({ ...prev, [redrawMeta.imageType]: false }));
    return redrawMeta;
  };

  useEffect(() => {
    refreshStatus(true).then((nextStatus) => {
      if (nextStatus.ready) {
        loadHistory().catch(() => {});
        refreshBackgroundJobs();
      }
    }).catch(() => {});

    const timer = window.setInterval(() => {
      refreshStatus(false).catch(() => {});
      refreshBackgroundJobs();
    }, 8000);

    const unsubscribe = window.electronAPI?.onImageStudioEvent?.((payload: ImageStudioEventPayloadLike | null) => {
      if (!payload) return;

      if (payload.type === "generate:complete" || payload.type === "generate:error" || payload.type === "generate:cancelled") {
        refreshBackgroundJobs();
        if (payload.type === "generate:complete") {
          loadHistory().catch(() => {});
        }
      }

      const redrawMeta = payload.jobId ? redrawJobsRef.current[payload.jobId] : undefined;
      const isForegroundJob = payload.jobId === currentJobIdRef.current;
      const isRedrawJob = Boolean(redrawMeta);
      if (!isForegroundJob && !isRedrawJob) return;

      if (payload.type === "generate:event" && payload.event?.imageType) {
        const imageType = payload.event.imageType || "";
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
                error: payload.event.error || "\u751f\u6210\u5931\u8d25",
              };
            }

            return next;
          });
        });

        if (payload.event.status === "done" && payload.event.imageUrl) {
          const imagePrompt = redrawMeta?.prompt || plansRef.current.find((plan) => plan.imageType === imageType)?.prompt;
          appendGeneratedVariant(
            {
              imageType,
              imageUrl: payload.event.imageUrl,
            },
            {
              prompt: imagePrompt,
              suggestion: redrawMeta?.suggestion || "",
              activate: true,
            },
          );
        }
      }

      if (payload.type === "generate:complete") {
        if (isRedrawJob && redrawMeta) {
          clearRedrawJob(payload.jobId);
          const redrawLabel = IMAGE_TYPE_LABELS[redrawMeta.imageType] || redrawMeta.imageType;
          if (payload.historySaveError) {
            message.warning(`${redrawLabel} \u5df2\u65b0\u589e\u4e00\u4e2a\u5019\u9009\u7248\u672c\uff0c\u4f46\u81ea\u52a8\u4fdd\u5b58\u5386\u53f2\u5931\u8d25\uff1a${payload.historySaveError}`);
          } else if (payload.historySaved) {
            message.success(`${redrawLabel} \u5df2\u65b0\u589e\u4e00\u4e2a\u5019\u9009\u7248\u672c\uff0c\u5e76\u5df2\u81ea\u52a8\u4fdd\u5b58\u5230\u5386\u53f2\u8bb0\u5f55`);
          } else {
            message.success(`${redrawLabel} \u5df2\u65b0\u589e\u4e00\u4e2a\u5019\u9009\u7248\u672c`);
          }
          return;
        }

        setGenerating(false);
        setCurrentJobId("");
        const completedImages = sortImagesBySelectedTypes(Array.isArray(payload.results) ? payload.results : [], selectedImageTypesRef.current);
        const nextVariantMap = completedImages.reduce<ImageVariantMap>((acc, item) => {
          const currentPlan = plansRef.current.find((plan) => plan.imageType === item.imageType);
          return appendVariantToMap(acc, item, {
            prompt: currentPlan?.prompt,
            suggestion: "",
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
        if (payload.historySaveError) {
          message.warning(`AI \u51fa\u56fe\u5df2\u5b8c\u6210\uff0c\u4f46\u81ea\u52a8\u4fdd\u5b58\u5386\u53f2\u5931\u8d25\uff1a${payload.historySaveError}`);
        } else if (payload.historySaved) {
          message.success("AI \u51fa\u56fe\u5df2\u5b8c\u6210\uff0c\u5e76\u5df2\u81ea\u52a8\u4fdd\u5b58\u5230\u5386\u53f2\u8bb0\u5f55");
        } else {
          message.success("AI \u51fa\u56fe\u5df2\u5b8c\u6210");
        }
      }

      if (payload.type === "generate:error") {
        if (isRedrawJob && redrawMeta) {
          clearRedrawJob(payload.jobId);
          const redrawLabel = IMAGE_TYPE_LABELS[redrawMeta.imageType] || redrawMeta.imageType;
          setResults((prev) => {
            const current = getResultState(prev, redrawMeta.imageType);
            const hasImage = Boolean(current.imageUrl || getActiveVariant(redrawMeta.imageType)?.imageUrl);
            return {
              ...prev,
              [redrawMeta.imageType]: {
                ...current,
                status: hasImage ? "done" : "error",
                error: payload.error || "AI \u51fa\u56fe\u5931\u8d25",
              },
            };
          });
          message.error(`${redrawLabel} \u91cd\u7ed8\u5931\u8d25\uff1a${payload.error || "AI \u51fa\u56fe\u5931\u8d25"}`);
          return;
        }

        setGenerating(false);
        setCurrentJobId("");
        message.error(payload.error || "AI \u51fa\u56fe\u5931\u8d25");
      }

      if (payload.type === "generate:cancelled") {
        if (isRedrawJob && redrawMeta) {
          clearRedrawJob(payload.jobId);
          setResults((prev) => {
            const current = getResultState(prev, redrawMeta.imageType);
            const hasImage = Boolean(current.imageUrl || getActiveVariant(redrawMeta.imageType)?.imageUrl);
            return {
              ...prev,
              [redrawMeta.imageType]: {
                ...current,
                status: hasImage ? "done" : "idle",
                error: "",
              },
            };
          });
          message.info(payload.message || `${IMAGE_TYPE_LABELS[redrawMeta.imageType] || redrawMeta.imageType} \u5df2\u53d6\u6d88\u91cd\u7ed8`);
          return;
        }

        setGenerating(false);
        setCurrentJobId("");
        message.info(payload.message || "\u5df2\u53d6\u6d88\u672c\u6b21\u751f\u6210");
      }
    });

    return () => {
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, []);

  const _handleRestart = async () => {
    setActionLoading(true);
    try {
      if (!imageStudioAPI) throw new Error("当前环境不支持 AI 出图服务");
      const nextStatus = await imageStudioAPI.restart();
      setStatus(nextStatus);
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
      setOpenRedrawComposerFor(null);
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
      setOpenRedrawComposerFor(null);
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
    if (Object.values(redrawingTypes).some(Boolean)) {
      message.warning("\u5f53\u524d\u8fd8\u6709\u56fe\u7247\u91cd\u7ed8\u4efb\u52a1\u5728\u8fd0\u884c\uff0c\u8bf7\u7b49\u5f85\u5b8c\u6210\u540e\u518d\u5f00\u59cb\u6574\u6279\u51fa\u56fe");
      return;
    }
    if (uploadFiles.length === 0) {
      message.warning("\u8bf7\u5148\u4e0a\u4f20\u5546\u54c1\u7d20\u6750\u56fe");
      return;
    }
    if (plans.length === 0) {
      message.warning("\u8bf7\u5148\u751f\u6210\u51fa\u56fe\u65b9\u6848");
      return;
    }
    const nextJobId = `image_job_${Date.now()}`;

    if (!runInBackground) {
      setGenerating(true);
      setCurrentJobId(nextJobId);
      redrawJobsRef.current = {};
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
      // 套装件数：
      // 1. 件数约束对"所有"图片类型都生效——画面里必须出现 N 件同款商品
      // 2. "NPCS" 文字角标"只"加在主图（main）上，避免细节图/场景图等被角标打扰
      const clampedPack = Math.max(1, Math.min(12, Math.floor(packCount || 1)));
      const patchedPlans = clampedPack > 1
        ? plans.map((plan) => {
            const isMain = plan.imageType === "main";
            const directive = isMain
              ? `【套装件数 · 强约束】
1. 画面必须展示 ${clampedPack} 件完全相同的该商品同框（${clampedPack}PCS / ${clampedPack}-pack 装），件数严格等于 ${clampedPack}，不多不少。摆放自然整齐，每件商品完整可见，避免遮挡造成数不清件数。
2. 必须在图片显眼位置（如左上角或右下角）叠加加粗、清晰、有底色或描边的文字角标「${clampedPack}PCS」（或「${clampedPack}-PACK」「SET OF ${clampedPack}」），字号醒目、与商品形成对比，符合 Temu / Amazon 主图规范，不遮挡商品主体。

`
              : `【套装件数约束】画面必须展示 ${clampedPack} 件完全相同的该商品同框，件数严格等于 ${clampedPack}，不多不少。不要在图片上叠加任何「${clampedPack}PCS」文字角标——此类角标只用于主图，其它图保持干净画面。

`;
            return { ...plan, prompt: directive + (plan.prompt || "") };
          })
        : plans;
      await imageStudioAPI.startGenerate({
        jobId: nextJobId,
        files,
        plans: patchedPlans,
        productMode,
        runInBackground,
        salesRegion,
        imageLanguage,
        imageSize,
        productName: displayProductName,
      });
      if (runInBackground) {
        message.success(`\u300c${displayProductName}\u300d\u5df2\u5728\u540e\u53f0\u751f\u6210\uff0c\u5b8c\u6210\u540e\u4f1a\u81ea\u52a8\u4fdd\u5b58\u5230\u5386\u53f2\u8bb0\u5f55`);
        refreshBackgroundJobs();
        resetStudio();
      } else {
        message.success("AI \u51fa\u56fe\u4efb\u52a1\u5df2\u5f00\u59cb");
      }
    } catch (error) {
      if (!runInBackground) {
        setGenerating(false);
        setCurrentJobId("");
      }
      message.error(error instanceof Error ? error.message : "\u542f\u52a8\u51fa\u56fe\u5931\u8d25");
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

      setAnalysis((prev) => ({ ...prev, productName: normalizeProductDisplayName(historyItem.productName) || prev.productName }));
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
      // 尝试拉取这次历史的原始素材图，回填 uploadFiles
      try {
        const sources = await imageStudioAPI.getHistorySources?.(historyItem.id);
        if (sources && Array.isArray(sources.files) && sources.files.length > 0) {
          const restored: UploadFile[] = await Promise.all(sources.files.map(async (s: ImageStudioHistorySourceFile, i: number) => {
            const resp = await fetch(s.dataUrl);
            const blob = await resp.blob();
            const file = new File([blob], s.name || `source-${i}`, { type: s.type || blob.type || "image/jpeg" });
            return {
              uid: `restored-source-${historyItem.id}-${i}`,
              name: file.name,
              status: "done",
              originFileObj: file as any,
            } as UploadFile;
          }));
          setUploadFiles(restored.slice(0, 5));
        } else {
          setUploadFiles([]);
        }
      } catch {
        setUploadFiles([]);
      }
      message.success("已恢复这次历史记录，可以继续筛图、评分或重绘");
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

  const handleTranslateAnalysisField = async (field: MarketingInfoField, label: string) => {
    if (!imageStudioAPI?.translate) {
      message.error("\u5f53\u524d\u7248\u672c\u6682\u4e0d\u652f\u6301\u7ffb\u8bd1");
      return;
    }

    const items = Array.isArray(analysis[field]) ? analysis[field] : [];
    const translatableIndexes: number[] = [];
    const texts: string[] = [];

    items.forEach((item, index) => {
      const source = typeof item === "string" ? item.trim() : "";
      if (!source || !containsChineseText(source) || hasMarketingTranslation(source)) {
        return;
      }
      translatableIndexes.push(index);
      texts.push(source);
    });

    if (texts.length === 0) {
      message.info(`${label} \u6682\u65e0\u9700\u8981\u7ffb\u8bd1\u7684\u5185\u5bb9`);
      return;
    }

    setTranslatingFields((prev) => ({ ...prev, [field]: true }));
    try {
      const result = await imageStudioAPI.translate({ texts });
      const translations = Array.isArray(result?.translations) ? result.translations : [];
      const nextItems = [...items];

      translatableIndexes.forEach((itemIndex, translationIndex) => {
        nextItems[itemIndex] = mergeMarketingTranslation(items[itemIndex] || "", translations[translationIndex] || "");
      });

      updateAnalysisField(field, nextItems);
      message.success(`${label} \u5df2\u8865\u9f50\u82f1\u6587\u7ffb\u8bd1`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "\u7ffb\u8bd1\u5931\u8d25");
    } finally {
      setTranslatingFields((prev) => ({ ...prev, [field]: false }));
    }
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

  const handleSingleRedraw = async (imageType: string, mode: "direct" | "guided" = "guided") => {
    if (!imageStudioAPI) return;
    if (generating) {
      message.warning("\u5f53\u524d\u8fd8\u6709\u751f\u6210\u4efb\u52a1\u5728\u8fd0\u884c\uff0c\u8bf7\u5148\u7b49\u5f85\u5b8c\u6210\u6216\u53d6\u6d88");
      return;
    }
    if (redrawingTypes[imageType]) {
      message.warning(`${IMAGE_TYPE_LABELS[imageType] || imageType} \u6b63\u5728\u91cd\u7ed8\u4e2d\uff0c\u8bf7\u7a0d\u5019`);
      return;
    }

    let effectiveFiles = uploadFiles;
    if (effectiveFiles.length === 0) {
      try {
        const fallbackVariant = getActiveVariant(imageType);
        const fallbackUrl = fallbackVariant?.imageUrl;
        if (!fallbackUrl) {
          message.warning("\u8bf7\u5148\u4e0a\u4f20\u5546\u54c1\u7d20\u6750\u56fe");
          return;
        }
        const resp = await fetch(fallbackUrl);
        if (!resp.ok) throw new Error(`\u4e0b\u8f7d\u7d20\u6750\u5931\u8d25 ${resp.status}`);
        const blob = await resp.blob();
        const ext = blob.type.includes("png") ? "png" : "jpg";
        const file = new File([blob], `redraw-source-${imageType}.${ext}`, { type: blob.type || "image/jpeg" });
        effectiveFiles = [{
          uid: `redraw-source-${imageType}-${Date.now()}`,
          name: file.name,
          status: "done",
          originFileObj: file as any,
        } as UploadFile];
      } catch (error) {
        message.error(error instanceof Error ? `\u81ea\u52a8\u590d\u7528\u5386\u53f2\u56fe\u5931\u8d25\uff1a${error.message}` : "\u81ea\u52a8\u590d\u7528\u5386\u53f2\u56fe\u5931\u8d25");
        return;
      }
    }

    const suggestion = (redrawSuggestions[imageType] || "").trim();
    if (mode === "guided" && !suggestion) {
      message.warning(REDRAW_UI_TEXT.needSuggestion);
      return;
    }

    const basePlan = plans.find((plan) => plan.imageType === imageType);
    if (!basePlan) {
      message.warning("\u5f53\u524d\u56fe\u7c7b\u578b\u8fd8\u6ca1\u6709\u51fa\u56fe\u65b9\u6848\uff0c\u8bf7\u5148\u751f\u6210\u65b9\u6848");
      return;
    }

    const activeVariant = getActiveVariant(imageType);
    const nextPrompt = mode === "guided"
      ? buildRedrawPrompt(activeVariant?.prompt?.trim() || basePlan.prompt, suggestion, imageType)
      : buildDirectRedrawPrompt(activeVariant?.prompt?.trim() || basePlan.prompt, imageType);
    const redrawPlan: ImageStudioPlan = {
      ...basePlan,
      prompt: nextPrompt,
      title: `${basePlan.title || IMAGE_TYPE_LABELS[imageType] || imageType} \u00b7 \u5019\u9009\u91cd\u7ed8`,
    };
    const nextJobId = `image_redraw_${imageType}_${Date.now()}`;

    redrawJobsRef.current = {
      ...redrawJobsRef.current,
      [nextJobId]: {
        imageType,
        suggestion: mode === "guided" ? suggestion : "",
        prompt: nextPrompt,
      },
    };
    setOpenRedrawComposerFor(null);
    setRedrawingTypes((prev) => ({ ...prev, [imageType]: true }));
    setResults((prev) => ({
      ...prev,
      [imageType]: { ...getResultState(prev, imageType), status: "generating", error: "" },
    }));

    try {
      const files = await buildNativeImagePayloads(effectiveFiles);
      await imageStudioAPI.startGenerate({
        jobId: nextJobId,
        files,
        plans: [redrawPlan],
        productMode,
        runInBackground: false,
        salesRegion,
        imageLanguage,
        imageSize,
        productName: displayProductName,
      });
      message.success(`${REDRAW_UI_TEXT.redrawStarted}${IMAGE_TYPE_LABELS[imageType] || imageType}`);
    } catch (error) {
      clearRedrawJob(nextJobId);
      setResults((prev) => {
        const current = getResultState(prev, imageType);
        const hasImage = Boolean(current.imageUrl || getActiveVariant(imageType)?.imageUrl);
        return {
          ...prev,
          [imageType]: {
            ...current,
            status: hasImage ? "done" : "error",
            error: error instanceof Error ? error.message : "\u542f\u52a8\u91cd\u7ed8\u5931\u8d25",
          },
        };
      });
      message.error(error instanceof Error ? error.message : "\u542f\u52a8\u91cd\u7ed8\u5931\u8d25");
    }
  };

  const downloadImage = async (image: ImageStudioGeneratedImage) => {
    const baseName = sanitizeDownloadNamePart(displayProductName || "temu-image");
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
  const activeGeneratingCount = useMemo(
    () => Object.values(results).filter((result) => result.status === "generating").length,
    [results],
  );
  const activeRedrawCount = useMemo(
    () => Object.values(redrawingTypes).filter(Boolean).length,
    [redrawingTypes],
  );
  const hasActiveRedraws = activeRedrawCount > 0;
  const progressPercent = useMemo(() => {
    if (planCount <= 0) return 0;
    const completedPercent = (completedCount / planCount) * 100;
    if (!generating && activeRedrawCount <= 0) {
      return Math.round(completedPercent);
    }
    if (completedPercent > 0) {
      return Math.round(completedPercent);
    }
    if (activeGeneratingCount > 0) {
      return Math.max(8, Math.round((activeGeneratingCount / planCount) * 20));
    }
    if (activeRedrawCount > 0) {
      return Math.max(8, Math.round((activeRedrawCount / planCount) * 20));
    }
    return 0;
  }, [activeGeneratingCount, activeRedrawCount, completedCount, generating, planCount]);
  const progressDescription = useMemo(() => {
    if (!generating && activeRedrawCount > 0) {
      return `\u5f53\u524d\u6709 ${activeRedrawCount} \u5f20\u56fe\u7247\u6b63\u5728\u91cd\u7ed8\uff0c\u5b8c\u6210\u540e\u4f1a\u81ea\u52a8\u8ffd\u52a0\u5230\u5404\u81ea\u5019\u9009\u7248\u672c\u3002`;
    }
    if (generatedImages.length > 0) {
      return `\u5f53\u524d\u5df2\u5b8c\u6210 ${successCount}/${planCount} \u5f20\u56fe\u7247\uff0c\u53ef\u4ee5\u7ee7\u7eed\u8bc4\u5206\u3001\u4fdd\u5b58\u548c\u590d\u5236\u6807\u9898\u3002`;
    }
    if (generating) {
      return "\u56fe\u7247\u5df2\u7ecf\u5f00\u59cb\u751f\u6210\uff0c\u7ed3\u679c\u4f1a\u5728\u4e0b\u65b9\u9646\u7eed\u51fa\u73b0\u3002";
    }
    return "\u65b9\u6848\u786e\u8ba4\u540e\u5f00\u59cb\u751f\u6210\u56fe\u7247\uff0c\u5e76\u5728\u4e0b\u65b9\u67e5\u770b\u5b8c\u6210\u7ed3\u679c\u3002";
  }, [activeRedrawCount, generatedImages.length, generating, planCount, successCount]);
  const hasUploads = uploadFiles.length > 0;
  const hasAnalysis = useMemo(() => hasAnalysisContent(analysis), [analysis]);
  const hasPlans = plans.length > 0;
  const titleSuggestions = useMemo(() => buildTitleSuggestions(analysis), [analysis]);
  const displayProductName = normalizeProductDisplayName(analysis.productName) || "未命名商品";

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

  const currentRegion = regionCards.find((region) => region.value === salesRegion);
  const currentLanguage = IMAGE_LANGUAGE_OPTIONS.find((option) => option.value === imageLanguage);
  const canChooseProductMode = uploadFiles.length > 1;
  const canResetStudio = hasUploads || hasAnalysis || hasPlans || generatedImages.length > 0;
  const filledPreviewFiles = uploadFiles.slice(0, 3);
  const hiddenPreviewCount = Math.max(0, uploadFiles.length - filledPreviewFiles.length);
  const runningBackgroundJobs = backgroundJobs.filter((job) => job.status === "running" || job.status === "pending");
  const completedBackgroundJobs = backgroundJobs.filter((job) => job.status !== "running" && job.status !== "pending");
  const primaryBackgroundJob = runningBackgroundJobs[0] || backgroundJobs[0] || null;
  const intakeStickyHint = hasUploads ? "已上传素材，可直接开始 AI 分析" : "上传后即可开始 AI 分析";
  const uploadDropzoneDescription = hasUploads
    ? uploadFiles.length >= 2
      ? "素材已经够开始分析了，也可以再补几张细节图，让识别和方案更稳。"
      : "已上传首张素材，建议再补 1 张细节图或尺寸图，分析会更稳。"
    : "建议上传主图、细节图、材质图和尺寸图，AI 会更容易识别卖点并生成更稳的方案。";


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
    if (!imageStudioAPI) return;

    setDownloadingAll(true);
    try {
      const result = await imageStudioAPI.downloadAll({
        images: generatedImages,
        productName: displayProductName || "temu-image",
      });
      if (result?.cancelled) return;
      if (result?.saved === result?.total) {
        message.success(`已保存 ${result.saved} 张图片到文件夹`);
      } else if ((result?.saved || 0) > 0) {
        message.warning(`已保存 ${result.saved}/${result.total} 张图片`);
      } else {
        message.error("保存失败，请重试");
      }
    } catch (err: any) {
      message.error(err?.message || "下载失败");
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
    setOpenRedrawComposerFor(null);
    setRedrawingTypes({});
    setGenerating(false);
    setCurrentJobId("");
    redrawJobsRef.current = {};
    setActiveStep(0);
  };

  const updateUploadFiles = (nextFiles: UploadFile[]) => {
    setUploadFiles(nextFiles.slice(-5));
  };

  const handleProductModeChange = (nextMode: string) => {
    if (!nextMode || nextMode === productMode) return;
    setProductMode(nextMode);
    if (hasAnalysis || hasPlans || generatedImages.length > 0) {
      setActiveStep(0);
      message.info("已切换商品模式，建议重新执行 AI 分析以刷新方案。");
    }
  };

  useEffect(() => {
    if (uploadFiles.length <= 1 && productMode !== "single") {
      setProductMode("single");
    }
  }, [productMode, uploadFiles.length]);

  const _renderStepZeroLegacy = () => (
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

  const renderStepZero = () => (
    <div className="studio-step-zero">
      <div className="studio-intake-sticky">
        <div className="studio-intake-sticky__meta">
          <div className="studio-intake-sticky__title">
            {hasUploads ? `已上传 ${uploadFiles.length}/5 张素材` : "先选市场，再上传商品图"}
          </div>
          <div className="studio-intake-sticky__desc">{intakeStickyHint}</div>
        </div>

        <div className="studio-intake-sticky__actions">
          <Select
            value={salesRegion}
            popupMatchSelectWidth={false}
            className="studio-intake-select"
            options={regionCards.map((region) => ({
              value: region.value,
              label: `${region.code} ${region.label}`,
            }))}
            onChange={(value) => {
              setSalesRegion(value);
              setImageLanguage(getDefaultImageLanguageForRegion(value));
            }}
          />

          <Button
            type="primary"
            size="large"
            icon={<RocketOutlined />}
            onClick={handleAnalyze}
            loading={analyzing}
            disabled={!hasUploads}
            style={{
              minWidth: 220,
              height: 46,
              borderRadius: 16,
              border: "none",
              background: TEMU_BUTTON_GRADIENT,
              boxShadow: TEMU_BUTTON_SHADOW,
            }}
          >
            {`开始 AI 分析${hasUploads ? `（${uploadFiles.length} 张图）` : ""}`}
          </Button>

          <div className="studio-intake-sticky__utility">
            <Button icon={<HistoryOutlined />} onClick={handleOpenHistory} style={{ height: 46, borderRadius: 16 }}>
              历史记录
            </Button>
            {primaryBackgroundJob ? renderBackgroundJobsWidget() : null}
          </div>
        </div>
      </div>

      <div className="studio-upload-layout">
        <div className="studio-upload-main">
          <Upload.Dragger
            accept="image/*"
            multiple
            beforeUpload={() => false}
            fileList={uploadFiles}
            maxCount={5}
            onChange={({ fileList }) => updateUploadFiles(fileList)}
            showUploadList={false}
            className={`studio-dropzone${hasUploads ? " is-filled" : ""}`}
            style={{ background: "transparent", border: "none", padding: 0 }}
          >
            <div className={`studio-dropzone__inner${hasUploads ? " is-filled" : ""}`}>
              {hasUploads ? (
                <>
                  <div className="studio-dropzone__filled-top">
                    <span className="studio-pill is-success">
                      <CheckCircleOutlined />
                      {`已上传 ${uploadFiles.length}/5 张`}
                    </span>
                    <span className="studio-pill">{`市场 ${currentRegion?.label || salesRegion}`}</span>
                  </div>

                  <div className="studio-dropzone__filled-main">
                    <div className="studio-dropzone__filled-copy">
                      <Title level={3} style={{ margin: 0, color: TEMU_TEXT }}>
                        素材已就绪
                      </Title>
                      <div className="studio-dropzone__filled-preview">
                        {filledPreviewFiles.map((file, index) => {
                          const shouldShowMoreMask = hiddenPreviewCount > 0 && index === filledPreviewFiles.length - 1;
                          return (
                            <div key={file.uid} className="studio-dropzone__filled-thumb">
                              <img
                                src={file.thumbUrl || (file.originFileObj ? URL.createObjectURL(file.originFileObj) : "")}
                                alt={file.name}
                                className="studio-dropzone__filled-thumb-image"
                              />
                              {shouldShowMoreMask ? (
                                <div className="studio-dropzone__filled-more">{`+${hiddenPreviewCount}`}</div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      <Text type="secondary" className="studio-dropzone__desc">
                        {uploadDropzoneDescription}
                      </Text>
                    </div>

                    <div className="studio-dropzone__actions studio-dropzone__actions--filled">
                      <Button
                        type="primary"
                        size="large"
                        icon={<UploadOutlined />}
                        style={{
                          minWidth: 156,
                          height: 46,
                          borderRadius: 16,
                          border: "none",
                          background: TEMU_BUTTON_GRADIENT,
                          boxShadow: TEMU_BUTTON_SHADOW,
                        }}
                      >
                        继续加图
                      </Button>
                      <Button
                        icon={<DeleteOutlined />}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setUploadFiles([]);
                        }}
                        style={{ height: 46, borderRadius: 16 }}
                      >
                        清空
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="studio-dropzone__icon">
                    <UploadOutlined style={{ color: "#fff", fontSize: 28 }} />
                  </div>
                  <Title level={3} style={{ margin: 0, color: TEMU_TEXT }}>
                    拖拽商品图片到这里
                  </Title>
                  <Text type="secondary" className="studio-dropzone__desc">
                    支持单品、组合装和多规格素材，拖拽或点击都可以上传。
                  </Text>
                  <div className="studio-dropzone__actions">
                    <Button
                      type="primary"
                      size="large"
                      icon={<UploadOutlined />}
                      style={{
                        minWidth: 156,
                        height: 46,
                        borderRadius: 16,
                        border: "none",
                        background: TEMU_BUTTON_GRADIENT,
                        boxShadow: TEMU_BUTTON_SHADOW,
                      }}
                    >
                      选择图片
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Upload.Dragger>

          {canChooseProductMode ? (
            <div className="studio-mode-block studio-mode-block--surface">
              <div className="studio-setup-panel__head">
                <div className="studio-setup-panel__eyebrow">商品模式</div>
                <div className="studio-setup-panel__desc">这组素材是什么关系？只需确认一次。</div>
              </div>

              <div className="studio-mode-grid studio-mode-grid--compact">
                {PRODUCT_MODE_OPTIONS.map((option) => {
                  const selected = option.value === productMode;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleProductModeChange(option.value)}
                      className={`studio-mode-card${selected ? " is-selected" : ""}`}
                    >
                      <div className="studio-mode-card__title-row">
                        <span className="studio-mode-card__title">{option.label}</span>
                        {selected ? <span className="studio-mode-card__tag">当前</span> : null}
                      </div>
                      <div className="studio-mode-card__desc">{option.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

      </div>
    </div>
  );

  const _clearCompletedBackgroundJobs = async () => {
    if (!imageStudioAPI || completedBackgroundJobs.length === 0) return;
    await Promise.allSettled(completedBackgroundJobs.map((job) => imageStudioAPI.clearJob(job.jobId)));
    refreshBackgroundJobs();
  };

  const handleOpenBackgroundJobHistory = async () => {
    await loadHistory();
    setHistoryOpen(true);
  };

  const renderBackgroundJobsWidget = () => {
    if (!primaryBackgroundJob) return null;

    const isRunning = primaryBackgroundJob.status === "running" || primaryBackgroundJob.status === "pending";
    const buttonLabel = isRunning
      ? `后台任务${runningBackgroundJobs.length > 1 ? ` ${runningBackgroundJobs.length}` : ""}`
      : "后台任务";

    return (
      <Button
        icon={<ThunderboltOutlined />}
        onClick={handleOpenBackgroundJobHistory}
        style={{ height: 46, borderRadius: 16 }}
      >
        {buttonLabel}
      </Button>
    );
  };

  const renderAnalysisListEditor = (
    label: string,
    field: MarketingInfoField,
    placeholder: string,
  ) => {
    const items = (analysis[field] || []).length > 0 ? analysis[field] : [""];
    const canTranslate = items.some((item) => {
      const source = typeof item === "string" ? item.trim() : "";
      return Boolean(source) && containsChineseText(source) && !hasMarketingTranslation(source);
    });
    return (
      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12 }}>
          <Text style={{ fontSize: 12, color: "#999" }}>{label}</Text>
          <Space size={12}>
            <Button
              size="small"
              type="text"
              loading={translatingFields[field]}
              disabled={!canTranslate}
              style={{ color: TEMU_ORANGE, paddingInline: 0 }}
              onClick={() => handleTranslateAnalysisField(field, label)}
            >
              {"\u7ffb\u8bd1\u672c\u7ec4"}
            </Button>
            <Button
              size="small"
              type="text"
              style={{ color: TEMU_ORANGE, paddingInline: 0 }}
              onClick={() => updateAnalysisField(field, [...items, ""])}
            >
              {"\u65b0\u589e\u4e00\u6761"}
            </Button>
          </Space>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item, index) => (
            <div
              key={field + "-" + index}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: "1px solid #e8edf3",
                borderRadius: 12,
                padding: 8,
                background: "#fff",
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  background: "#fff5ec",
                  color: TEMU_ORANGE,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  flex: "0 0 auto",
                }}
              >
                {index + 1}
              </div>
              <Input
                value={item}
                onChange={(event) => {
                  const nextItems = [...items];
                  nextItems[index] = event.target.value;
                  updateAnalysisField(field, nextItems);
                }}
                placeholder={placeholder}
                bordered={false}
                style={{ flex: 1, fontSize: 13 }}
              />
              {items.length > 1 ? (
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => updateAnalysisField(field, items.filter((_, itemIndex) => itemIndex !== index))}
                  style={{ color: "#8b98ab" }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const allImageTypesSelected = selectedImageTypes.length === DEFAULT_IMAGE_TYPES.length;
  const toggleImageType = (imageType: string) => {
    setSelectedImageTypes((prev) => {
      if (prev.includes(imageType)) {
        return prev.filter((item) => item !== imageType);
      }
      return DEFAULT_IMAGE_TYPES.filter((item) => item === imageType || prev.includes(item));
    });
  };

  const renderStepOne = () => (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "4px 0", flexWrap: "wrap" }}>
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

      <div className="studio-type-panel">
        <div className="studio-type-panel__head">
          <div>
            <Text className="studio-type-panel__label">图片类型</Text>
            <Text className="studio-type-panel__hint">选择这次要生成的图片方向，通常保留 4 到 6 类就够用。</Text>
          </div>
          <div className="studio-type-panel__actions">
            <Tooltip title="N 件装：让模型在每张图里展示 N 件完全相同的同款商品同框（2PC / 3PC / 5PC …）。选 1 则只出单件商品。">
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px", background: "#fff", border: "1px solid #e6ebf1", borderRadius: 999, height: 28 }}>
                <Text style={{ fontSize: 12, color: "#5d6b80" }}>套装件数</Text>
                <InputNumber
                  size="small"
                  min={1}
                  max={12}
                  value={packCount}
                  onChange={(v) => setPackCount(typeof v === "number" && v >= 1 && v <= 12 ? Math.floor(v) : 1)}
                  controls={false}
                  style={{ width: 48 }}
                />
                <Text style={{ fontSize: 12, color: packCount > 1 ? "#fa8c16" : "#bfbfbf" }}>
                  {packCount > 1 ? `${packCount}PC` : "单件"}
                </Text>
              </div>
            </Tooltip>
            <Tag style={{ margin: 0, borderRadius: 999, paddingInline: 12, color: "#5d6b80", background: "#fff", borderColor: "#e6ebf1" }}>
              已选 {selectedImageTypes.length}/{DEFAULT_IMAGE_TYPES.length}
            </Tag>
            <Button
              size="small"
              onClick={() => setSelectedImageTypes(allImageTypesSelected ? [] : [...DEFAULT_IMAGE_TYPES])}
              style={{ borderRadius: 999 }}
            >
              {allImageTypesSelected ? "清空" : "全选"}
            </Button>
          </div>
        </div>
        <div className="studio-type-grid">
          {DEFAULT_IMAGE_TYPES.map((type) => {
            const selected = selectedImageTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                className={`studio-type-card${selected ? " is-selected" : ""}`}
                onClick={() => toggleImageType(type)}
              >
                <div className="studio-type-card__head">
                  <div className="studio-type-card__title">{IMAGE_TYPE_LABELS[type]}</div>
                  <CheckCircleOutlined className="studio-type-card__icon" />
                </div>
                <div className="studio-type-card__desc">
                  {getImageTypeSummaryHint(type) || "按这个方向生成更贴合场景的商品图。"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 8, padding: "16px 20px" }}>
        <Text strong style={{ fontSize: 15, color: "#333", display: "block", marginBottom: 12 }}>营销信息</Text>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          {renderAnalysisListEditor("核心卖点", "sellingPoints", "输入一条卖点")}
          {renderAnalysisListEditor("目标人群", "targetAudience", "输入一条目标人群")}
          {renderAnalysisListEditor("使用场景", "usageScenes", "输入一条使用场景")}
        </div>
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
              <div key={plan.imageType} className="studio-plan-card">
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
                          {PLAN_DISPLAY_SUBTITLES[plan.imageType] || "AI 自动方案"}
                        </Text>
                      </div>
                    </Space>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyText(plan.prompt, `${IMAGE_TYPE_LABELS[plan.imageType] || plan.imageType}方案已复制`)}
                      style={{ borderRadius: 12 }}
                    >
                      复制英文
                    </Button>
                  </div>
                  {(() => {
                    const preview = buildBilingualPlanPreview(plan, {
                      productName: analysis.productName,
                      regionLabel: currentRegion?.label || salesRegion,
                      languageLabel: currentLanguage?.label || imageLanguage,
                    });

                    return (
                      <div className="studio-plan-preview">
                        <div className="studio-plan-preview__summary">
                          <div className="studio-plan-preview__eyebrow">中文解读</div>
                          <div className="studio-plan-preview__goal">{preview.goal}</div>
                          <div className="studio-plan-preview__bullets">
                            {preview.highlights.map((item) => (
                              <div key={item} className="studio-plan-preview__bullet">
                                {item}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <TextArea
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    value={plan.prompt}
                    onChange={(event) => updatePlanPrompt(plan.imageType, event.target.value)}
                    placeholder="这里可以手动微调每张图的英文提示词…"
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

  const _renderGenerateStatusText = (status: string) => {
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
                {progressDescription}
              </Text>
            </div>
            <Space wrap>
              <Button onClick={() => setActiveStep(2)} disabled={generating || hasActiveRedraws} style={{ borderRadius: 14 }}>上一步</Button>
              <Button danger icon={<StopOutlined />} onClick={handleCancelGenerate} disabled={!generating || !currentJobId} style={{ borderRadius: 14 }}>
                取消任务
              </Button>
              <Button
                type="primary"
                icon={<RocketOutlined />}
                onClick={() => handleStartGenerate(false)}
                loading={generating}
                disabled={plans.length === 0 || uploadFiles.length === 0 || hasActiveRedraws}
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
                  disabled={plans.length === 0 || uploadFiles.length === 0 || generating || hasActiveRedraws}
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
                          <div
                            style={{
                              position: "absolute",
                              left: "50%",
                              bottom: 12,
                              transform: "translateX(-50%)",
                              display: "flex",
                              gap: 8,
                              zIndex: 4,
                            }}
                          >
                            <Tooltip title={REDRAW_UI_TEXT.score}>
                              <Button
                                shape="circle"
                                icon={<StarOutlined />}
                                onClick={() => handleScoreImage(image.imageType, activeVariant?.variantId)}
                                loading={Boolean(activeVariant?.scoring)}
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderColor: "#f2d4b4",
                                  background: "#fff",
                                  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.12)",
                                }}
                              />
                            </Tooltip>
                            <Tooltip title={REDRAW_UI_TEXT.redraw}>
                              <Button
                                shape="circle"
                                icon={<ReloadOutlined />}
                                onClick={() => setOpenRedrawComposerFor((prev) => (prev === image.imageType ? null : image.imageType))}
                                loading={Boolean(redrawingTypes[image.imageType])}
                                disabled={generating || Boolean(redrawingTypes[image.imageType])}
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderColor: "#ffd2ad",
                                  background: "#fff7ef",
                                  color: TEMU_ORANGE,
                                  boxShadow: "0 10px 24px rgba(255, 106, 0, 0.18)",
                                }}
                              />
                            </Tooltip>
                            <Tooltip title={REDRAW_UI_TEXT.download}>
                              <Button
                                shape="circle"
                                icon={<DownloadOutlined />}
                                onClick={() => handleDownloadImage(image)}
                                loading={Boolean(downloadingTypes[downloadKey])}
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderColor: "#d9e2ec",
                                  background: "#fff",
                                  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.12)",
                                }}
                              />
                            </Tooltip>
                          </div>

                          {openRedrawComposerFor === image.imageType ? (
                            <div
                              style={{
                                position: "absolute",
                                right: 12,
                                bottom: 58,
                                width: "min(280px, calc(100% - 24px))",
                                borderRadius: 18,
                                background: "rgba(255,255,255,0.98)",
                                boxShadow: "0 22px 44px rgba(15, 23, 42, 0.18)",
                                border: "1px solid #f1dfcf",
                                padding: 14,
                                zIndex: 5,
                                backdropFilter: "blur(10px)",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                <Space size={6}>
                                  <ReloadOutlined style={{ color: TEMU_ORANGE }} />
                                  <Text strong style={{ color: TEMU_TEXT }}>{REDRAW_UI_TEXT.redrawTitle}</Text>
                                </Space>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CloseOutlined />}
                                  onClick={() => setOpenRedrawComposerFor(null)}
                                  style={{ color: "#94a3b8" }}
                                />
                              </div>
                              <Text type="secondary" style={{ display: "block", marginBottom: 10, lineHeight: 1.6 }}>
                                这里只会重绘当前这张图，不会影响其他图片。
                              </Text>
                              <TextArea
                                autoSize={{ minRows: 4, maxRows: 6 }}
                                value={redrawSuggestions[image.imageType] || ""}
                                onChange={(event) => setRedrawSuggestions((prev) => ({ ...prev, [image.imageType]: event.target.value }))}
                                placeholder={REDRAW_UI_TEXT.redrawPlaceholder}
                                style={{ borderRadius: 12, marginBottom: 12 }}
                              />
                              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                                <Button
                                  onClick={() => handleSingleRedraw(image.imageType, "direct")}
                                  loading={Boolean(redrawingTypes[image.imageType])}
                                  disabled={generating || Boolean(redrawingTypes[image.imageType])}
                                  style={{ borderRadius: 12 }}
                                >
                                  {REDRAW_UI_TEXT.directRedraw}
                                </Button>
                                <Button
                                  type="primary"
                                  icon={<RocketOutlined />}
                                  onClick={() => handleSingleRedraw(image.imageType, "guided")}
                                  loading={Boolean(redrawingTypes[image.imageType])}
                                  disabled={generating || Boolean(redrawingTypes[image.imageType])}
                                  style={{
                                    borderRadius: 12,
                                    border: "none",
                                    background: TEMU_BUTTON_GRADIENT,
                                    boxShadow: TEMU_BUTTON_SHADOW,
                                  }}
                                >
                                  {REDRAW_UI_TEXT.guidedRedraw}
                                </Button>
                              </Space>
                            </div>
                          ) : null}
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
                <Text type="secondary">每张图都支持单独重绘，系统会保留原图，并为当前这张图新增候选版本。</Text>
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

  // 以下 helper / render 分支为旧版/实验版本，保留备用以避免 noUnusedLocals 误伤
  void _handleRestart;
  void _renderStepZeroLegacy;
  void _clearCompletedBackgroundJobs;
  void _renderGenerateStatusText;

  return (
    <div className="studio-shell">
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
        <div style={{ maxWidth: 1180, margin: "0 auto", width: "100%" }}>
          <Card
            className="studio-workspace-card"
            style={{
              borderRadius: TEMU_CARD_RADIUS,
              borderColor: "#eceff3",
              boxShadow: TEMU_CARD_SHADOW,
              background: "#ffffff",
            }}
            bodyStyle={{ padding: 18 }}
          >
            {activeStep !== 0 ? (
              <div className="studio-topbar">
                <Space size={10} wrap className="studio-topbar__actions">
                  <Button icon={<HistoryOutlined />} onClick={handleOpenHistory} style={{ height: 40, borderRadius: 16 }}>
                    历史记录
                  </Button>
                  {canResetStudio ? (
                    <Button icon={<ReloadOutlined />} onClick={resetStudio} style={{ height: 40, borderRadius: 16 }}>
                      重新开始
                    </Button>
                  ) : null}
                </Space>

                {primaryBackgroundJob ? renderBackgroundJobsWidget() : null}
              </div>
            ) : null}

            <div className="studio-workspace-card__content">
              {renderStepContent()}
            </div>
          </Card>
        </div>
      )}

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
                actions={[<Button key="load" type="link" onClick={() => handleLoadHistoryItem(item)}>恢复到当前页</Button>]}
              >
                <List.Item.Meta
                  title={normalizeProductDisplayName(item.productName) || "未命名商品"}
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
