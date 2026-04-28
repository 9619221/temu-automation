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
import { DesignerSummary, type DesignerResult } from "@/components/designer";
import {
  type ImageStudioComponentDetection,
  type ImageStudioDetectedComponent,
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
  type ImageStudioImage2PromptSpec,
  type ImageStudioMainImageStrategy,
  type ImageStudioPlan,
  type ImageStudioProductMode,
  type ImageStudioReferenceImage,
  type ImageStudioShotBrief,
  type ImageStudioVisibleTextSpec,
  type ImageStudioStatus,
  type NativeImagePayload,
} from "../utils/imageStudio";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const imageStudioAPI = window.electronAPI?.imageStudioGpt;
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
  jobId?: string;
  type: "generate:started" | "generate:event" | "generate:complete" | "generate:error" | "generate:cancelled";
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

type ComponentBundlePreviewState = {
  sourceFileUid: string;
  sourcePreviewUrl: string;
  components: ImageStudioDetectedComponent[];
};

type PreparedComponentBundleItem = {
  component: ImageStudioDetectedComponent;
  file: File;
  previewUrl: string;
};

type PreparedComponentBundleState = {
  sourceFileUid: string;
  selectionKey: string;
  items: PreparedComponentBundleItem[];
};

type MarketingInfoField = "sellingPoints" | "targetAudience" | "usageScenes";
type ProductFactField = "countAndConfiguration" | "mountingPlacement" | "packagingEvidence";
type NestedInsightListField = "factGuardrails" | "purchaseDrivers" | "usageActions" | "proofPoints" | "buyerQuestions" | "riskFlags";

const DESIGNER_PLAN_SOURCE = "gpt-designer-agent";
const IMAGE2_ECOMMERCE_PLAN_SOURCE = "image2-ecommerce-plan";
const SHOT_BRIEF_VERSION = "shotbrief-v1";
const SHOT_BRIEF_PROMPT_SOURCE = "gpt-image-2-shotbrief";

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
  const validFiles = collectOriginFiles(fileList);

  return buildNativeImagePayloadsFromFiles(validFiles);
}

function collectOriginFiles(fileList: UploadFile[]): File[] {
  return fileList.flatMap((item) => (item.originFileObj instanceof File ? [item.originFileObj] : []));
}

async function buildNativeImagePayloadsFromFiles(files: File[]): Promise<NativeImagePayload[]> {
  return Promise.all(
    files.map((file) => optimizeImageStudioFile(file)),
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
    || analysis.usageScenes.length > 0
    || (analysis.productFacts?.countAndConfiguration || "").trim()
    || (analysis.productFacts?.mountingPlacement || "").trim()
    || (analysis.productFacts?.packagingEvidence || "").trim()
    || (analysis.productFacts?.factGuardrails || []).length > 0
    || (analysis.operatorInsights?.purchaseDrivers || []).length > 0
    || (analysis.operatorInsights?.usageActions || []).length > 0
    || (analysis.operatorInsights?.proofPoints || []).length > 0
    || (analysis.operatorInsights?.buyerQuestions || []).length > 0
    || (analysis.operatorInsights?.riskFlags || []).length > 0
    || (analysis.creativeDirection?.pageGoal || "").trim()
    || (analysis.creativeDirection?.visualStyle || "").trim()
    || (analysis.creativeDirection?.aPlusStory || "").trim(),
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

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeDetectedComponents(input: ImageStudioDetectedComponent[] | undefined | null): ImageStudioDetectedComponent[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((component, index): ImageStudioDetectedComponent => ({
      id: Number.isFinite(component?.id) ? Math.max(1, Math.round(component.id)) : index + 1,
      labelZh: typeof component?.labelZh === "string" ? component.labelZh.trim() : "",
      labelEn: typeof component?.labelEn === "string" ? component.labelEn.trim() : "",
      kind: component?.kind === "group" ? "group" : "single",
      itemCount: Number.isFinite(Number(component?.itemCount)) ? Math.max(1, Math.round(Number(component?.itemCount))) : undefined,
      left: clampUnit(Number(component?.left ?? 0)),
      top: clampUnit(Number(component?.top ?? 0)),
      width: clampUnit(Number(component?.width ?? 0)),
      height: clampUnit(Number(component?.height ?? 0)),
    }))
    .filter((component) => component.width >= 0.02 && component.height >= 0.02)
    .map((component) => ({
      ...component,
      width: Math.min(component.width, 1 - component.left),
      height: Math.min(component.height, 1 - component.top),
    }))
    .slice(0, 12)
    .map((component, index) => ({
      ...component,
      id: index + 1,
    }));
}

function formatDetectedComponentName(component: ImageStudioDetectedComponent) {
  const zh = (component.labelZh || "").trim();
  const en = (component.labelEn || "").trim();
  if (zh && en && zh !== en) return `${zh} (${en})`;
  return zh || en || `组件 ${component.id}`;
}

function buildComboLabel(componentIds: number[]) {
  return [...componentIds]
    .sort((left, right) => left - right)
    .join("+");
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("图片预览读取失败"));
    reader.readAsDataURL(file);
  });
}

function sanitizeComponentFileName(value: string) {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "component";
}

async function cropDetectedComponentsToFiles(sourceFile: File, components: ImageStudioDetectedComponent[]): Promise<File[]> {
  if (components.length === 0) return [];

  const sourceUrl = URL.createObjectURL(sourceFile);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("组件裁图失败：源图加载失败"));
      element.src = sourceUrl;
    });

    const naturalWidth = image.naturalWidth || 1;
    const naturalHeight = image.naturalHeight || 1;
    const output: File[] = [];

    for (const component of components) {
      const padX = Math.max(8, Math.round(naturalWidth * component.width * 0.04));
      const padY = Math.max(8, Math.round(naturalHeight * component.height * 0.04));
      const left = Math.max(0, Math.floor(naturalWidth * component.left) - padX);
      const top = Math.max(0, Math.floor(naturalHeight * component.top) - padY);
      const right = Math.min(naturalWidth, Math.ceil(naturalWidth * (component.left + component.width)) + padX);
      const bottom = Math.min(naturalHeight, Math.ceil(naturalHeight * (component.top + component.height)) + padY);
      const cropWidth = Math.max(24, right - left);
      const cropHeight = Math.max(24, bottom - top);

      const canvas = document.createElement("canvas");
      canvas.width = cropWidth;
      canvas.height = cropHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("组件裁图失败：无法创建画布");
      }

      context.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png");
      });

      if (!blob) {
        throw new Error("组件裁图失败：导出图片为空");
      }

      const componentName = sanitizeComponentFileName(component.labelEn || component.labelZh || `component-${component.id}`);
      const fileName = `${String(component.id).padStart(2, "0")}-${componentName}.png`;
      output.push(new File([blob], fileName, { type: "image/png" }));
    }

    return output;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
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

function buildAnalysisSearchText(analysis: ImageStudioAnalysis) {
  return [
    analysis.productName,
    analysis.category,
    analysis.materials,
    analysis.colors,
    analysis.estimatedDimensions,
    analysis.productFacts?.productName,
    analysis.productFacts?.category,
    analysis.productFacts?.materials,
    analysis.productFacts?.colors,
    analysis.productFacts?.countAndConfiguration,
    analysis.productFacts?.mountingPlacement,
    analysis.creativeDirection?.visualStyle,
    analysis.creativeDirection?.aPlusStory,
    ...analysis.sellingPoints,
    ...analysis.usageScenes,
    ...(analysis.productFacts?.factGuardrails || []),
    ...(analysis.operatorInsights?.usageActions || []),
    ...(analysis.operatorInsights?.proofPoints || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function isBlackHeartMirrorProduct(analysis: ImageStudioAnalysis) {
  const text = buildAnalysisSearchText(analysis);
  const hasMirror = /mirror|wall\s*mirror|vanity\s*mirror|decorative\s*mirror|镜|壁镜|装饰镜/.test(text);
  const hasHeart = /heart|heart-shaped|心形|爱心/.test(text);
  const hasBlack = /black|matte\s*black|dark|gothic|黑|哑光黑|暗黑|哥特/.test(text);
  return hasMirror && hasHeart && hasBlack;
}

type ShotBriefBuildContext = {
  salesRegion: string;
  imageSize: string;
  imageLanguage: string;
  packCount?: number;
  productMode?: ImageStudioProductMode;
  comboLabel?: string;
  referenceImages?: ImageStudioReferenceImage[];
};

type ShotBriefBlueprint = {
  categoryStrategy?: string;
  proofType?: string;
  storyIntent?: string;
  shopperQuestion?: string;
  conversionRole?: string;
  purpose: string;
  scene: string;
  humanAction?: string;
  mirrorReflection?: string;
  composition: string;
  camera: string;
  lighting: string;
  style: string;
  requiredElements: string[];
  forbiddenElements: string[];
  overlayPlacement?: string;
  overlayAllowedText?: string[];
  overlayNotes?: string[];
};

function flattenShotValues(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [value];
  return value.flatMap((item) => flattenShotValues(item));
}

function compactShotList(values: unknown[]) {
  return dedupeTextList(
    values
      .flatMap((value) => flattenShotValues(value))
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function getPlanStringList(plan: ImageStudioPlan, key: string) {
  const value = plan[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

type PackCountPolicy = {
  requiredElements: string[];
  forbiddenElements: string[];
  overlayNotes: string[];
  allowedText: string[];
  visibleTextMode: ImageStudioVisibleTextSpec["mode"];
};

function buildImageTypePackCountPolicy(imageType: string, packCount: number): PackCountPolicy {
  if (packCount <= 1) {
    return {
      requiredElements: [],
      forbiddenElements: ["do not imply a multi-pack unless the product facts explicitly say so"],
      overlayNotes: [],
      allowedText: [],
      visibleTextMode: "none",
    };
  }

  if (imageType === "main") {
    return {
      requiredElements: [
        `Show exactly ${packCount} identical units of the product in the frame.`,
        `The visible count must be exactly ${packCount}, not more and not fewer.`,
        "Each unit must be fully visible and countable, arranged naturally with no severe overlap.",
      ],
      forbiddenElements: [
        "do not show fewer or more units than the required pack count",
        "do not hide units behind props or crop them off",
      ],
      overlayNotes: [
        `If a pack-count badge is needed, image2 must render the exact text "${packCount}PCS" once only.`,
        "No other visible text is allowed on the main image.",
      ],
      allowedText: [`${packCount}PCS`],
      visibleTextMode: "exact",
    };
  }

  if (imageType === "packaging") {
    return {
      requiredElements: [
        `Show what the customer receives: ${packCount} product units when package contents are visible.`,
        "Arrange package contents clearly; packaging is allowed only as delivered-package context.",
      ],
      forbiddenElements: [
        "do not turn package contents into a main-image pack-count badge",
        "do not add fictional accessories, manuals, labels, or packaging claims",
      ],
      overlayNotes: [
        `If package text is needed, image2 may render only "Package Includes" and "${packCount}PCS".`,
      ],
      allowedText: ["Package Includes", `${packCount}PCS`],
      visibleTextMode: "exact",
    };
  }

  if (imageType === "closeup") {
    return {
      requiredElements: [
        "Focus on one product unit or one real product detail; do not force the full pack count into this detail image.",
      ],
      forbiddenElements: ["no PCS badge", "do not squeeze the full bundle into the close-up"],
      overlayNotes: ["Detail labels are image2-only and should be omitted unless exact allowed copy is provided."],
      allowedText: [],
      visibleTextMode: "none",
    };
  }

  if (imageType === "dimensions") {
    return {
      requiredElements: [
        "Show one product unit for size clarity unless the product facts explicitly require package-size comparison.",
      ],
      forbiddenElements: [
        "no PCS badge",
        "do not invent dimension numbers",
        "do not show the full pack count unless needed for package dimensions",
      ],
      overlayNotes: ["If exact verified measurements are available, image2 may render only those exact measurement values."],
      allowedText: [],
      visibleTextMode: "exact",
    };
  }

  if (imageType === "lifestyle" || imageType === "lifestyle2" || imageType === "scene_a" || imageType === "scene_b") {
    return {
      requiredElements: [
        "Show active use of one product unit unless multiple units are required to explain the real use case.",
        "The scene must include visible interaction with the product; static placement beside props is not enough.",
        "Keep the pack count as product context, not as a forced visual count.",
      ],
      forbiddenElements: ["no PCS badge", "do not make the scene unnatural by forcing every unit into the frame", "no product-only still life pretending to be a use scene"],
      overlayNotes: ["Keep use-scene copy minimal; image2 owns the final artwork and no local text overlay will be added."],
      allowedText: [],
      visibleTextMode: "none",
    };
  }

  return {
    requiredElements: [
      "Only show the full pack count if it visually supports this image type; otherwise focus on the specific proof role.",
    ],
    forbiddenElements: ["no PCS badge unless this image is reused as a main image"],
    overlayNotes: ["If pack-count text is needed, image2 must render it directly from the exact allowed text list."],
    allowedText: [],
    visibleTextMode: "none",
  };
}

function inferReferenceRole(name: string, index: number, productMode?: ImageStudioProductMode) {
  const normalizedName = name.toLowerCase();
  if (productMode === "bundle") {
    return {
      role: `Selected sellable component ${index}`,
      instruction: "Use this selected crop as a sellable product component. Do not include unselected background objects.",
      sellableComponent: true,
    };
  }
  if (/pack|package|box|包装|盒/.test(normalizedName)) {
    return {
      role: "Packaging reference",
      instruction: "Use only for packaging appearance or delivered-package context. Do not treat packaging as a sellable component.",
      sellableComponent: false,
    };
  }
  if (/dimension|measurement|measure|size|guide|规格|尺寸|尺码|大小|测量/.test(normalizedName)) {
    return {
      role: "Size or dimension reference",
      instruction: "Use only for verified measurements, approximate scale, product silhouette, and composition hints. Do not treat it as a real clean product photo; do not copy scale props, hands, labels, or layout decorations into the main image.",
      sellableComponent: false,
    };
  }
  if (/screenshot|screen|mock|render|generated|ai|截图|截屏|效果图|渲染|生成/.test(normalizedName)) {
    return {
      role: "Generated or screenshot reference",
      instruction: "Use only as secondary visual context. It is not reliable enough to invent exact labels, packaging, certifications, or accessories.",
      sellableComponent: false,
    };
  }
  if (/detail|close|material|texture|细节|材质/.test(normalizedName)) {
    return {
      role: "Detail or material reference",
      instruction: "Use for material, surface, texture, edge, and construction fidelity.",
      sellableComponent: false,
    };
  }
  if (index === 1) {
    return {
      role: "Main product identity reference",
      instruction: "Use as the primary geometry, shape, color, material, and product identity reference.",
      sellableComponent: true,
    };
  }
  return {
    role: `Additional product reference ${index}`,
    instruction: "Use as secondary reference for angle, detail, color, material, or accessory relationship.",
    sellableComponent: productMode === "variants",
  };
}

function buildImage2ReferenceImages(
  sources: Array<{ name?: string }>,
  productMode?: ImageStudioProductMode,
  comboLabel?: string,
): ImageStudioReferenceImage[] {
  if (sources.length === 0) {
    return [{
      index: 1,
      label: "Image 1",
      role: "Uploaded product reference",
      instruction: "Use the uploaded product image as the product identity reference.",
      sellableComponent: true,
    }];
  }

  return sources.map((source, sourceIndex) => {
    const index = sourceIndex + 1;
    const role = inferReferenceRole(source.name || `reference-${index}`, index, productMode);
    return {
      index,
      label: `Image ${index}${source.name ? `: ${source.name}` : ""}`,
      role: comboLabel && productMode === "bundle" ? `${role.role} (${comboLabel})` : role.role,
      instruction: role.instruction,
      sellableComponent: role.sellableComponent,
    };
  });
}

function getMainStrategySearchText(analysis: ImageStudioAnalysis) {
  return [
    buildAnalysisSearchText(analysis),
    analysis.productFacts?.packagingEvidence,
    analysis.productFacts?.countAndConfiguration,
    analysis.productFacts?.mountingPlacement,
    analysis.creativeDirection?.pageGoal,
    analysis.creativeDirection?.visualStyle,
    analysis.creativeDirection?.aPlusStory,
    ...(analysis.operatorInsights?.purchaseDrivers || []),
    ...(analysis.operatorInsights?.usageActions || []),
    ...(analysis.operatorInsights?.proofPoints || []),
    ...(analysis.operatorInsights?.buyerQuestions || []),
    ...(analysis.operatorInsights?.riskFlags || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildMainImageStrategy(
  analysis: ImageStudioAnalysis,
  productStrategy: ProductVisualStrategy,
  context: ShotBriefBuildContext,
): ImageStudioMainImageStrategy {
  return buildCommerceMainImageStrategy(analysis, productStrategy, context);
}

function buildCommerceMainImageStrategy(
  analysis: ImageStudioAnalysis,
  productStrategy: ProductVisualStrategy,
  context: ShotBriefBuildContext,
): ImageStudioMainImageStrategy {
  const searchText = getMainStrategySearchText(analysis);
  const packCount = Math.max(1, Math.min(12, Math.floor(context.packCount || 1)));
  const hasGiftIntent = /\b(gift|present|holiday|birthday|christmas|wedding|valentine)\b|礼品|礼物|送礼|节日|生日|圣诞|婚礼|情人节/.test(searchText);
  const hasScaleRisk = Boolean(analysis.estimatedDimensions?.trim())
    || /\b(size|scale|small|large|compact|mini|dimension|fit|portable|palm|desk|wall|room)\b|尺寸|大小|小号|大号|迷你|紧凑|便携|掌心|桌面|墙面|房间|适配/.test(searchText);
  const needsUseHint = productStrategy.strategyName !== "universal-ecommerce-proof"
    && /\b(use|usage|wear|fit|install|mount|place|placement|operate|mirror|tool|storage|decor|home|kitchen|bath)\b|使用|佩戴|适配|安装|壁挂|摆放|操作|镜子|工具|收纳|装饰|家居|厨房|浴室/.test(`${productStrategy.strategyName} ${searchText}`);

  if (packCount > 1) {
    return {
      strategyName: "bundle_main",
      objective: "Make the exact pack count immediately visible while keeping the product identity clean.",
      thumbnailPromise: `This is a ${packCount}-pack of the exact same product.`,
      selectionReason: "Pack count is greater than one, so quantity clarity outranks mood, gift, or scene styling.",
      subjectRatio: "Combined products should fill about 72-86% of the square frame, with every unit countable.",
      backgroundPolicy: "Pure white or very light neutral studio background; no lifestyle room background.",
      propPolicy: "No decorative props unless they are tiny and do not interfere with counting.",
      cropPolicy: "All units fully visible, no cropped edges, no overlapping that makes the count unclear.",
      anglePolicy: "Front or mild three-quarter angle with repeated units arranged naturally and evenly.",
      lightingPolicy: "Soft diffused studio lighting with light grounding shadows and no harsh glare.",
      overlayPolicy: `If a pack-count badge is needed, image2 renders only the exact "${packCount}PCS" text once in a clean corner.`,
      qaChecks: [
        `exactly ${packCount} identical units are visible`,
        "the product identity still matches the reference",
        "any pack-count text is exact and generated by image2",
        "thumbnail remains readable at small size",
      ],
    };
  }

  if (hasScaleRisk) {
    return {
      strategyName: "scale_main",
      objective: "Keep the main image clean while preventing size misunderstanding.",
      thumbnailPromise: "The shopper can trust the product size and proportion.",
      selectionReason: "The brief contains size or fit risk, so scale truth outranks gift styling and decorative mood.",
      subjectRatio: "Product should fill about 68-82% of the frame with enough whitespace to perceive shape.",
      backgroundPolicy: "Light neutral background or minimal surface; avoid dense room scenes and dramatic editorial staging.",
      propPolicy: "No props by default. If scale is unclear, use at most one familiar, neutral scale cue that stays secondary.",
      cropPolicy: "Full product visible with clear margins; do not enlarge it into an unrealistic size.",
      anglePolicy: "Front or mild three-quarter angle that preserves true proportions.",
      lightingPolicy: "Even soft light that does not distort size, edges, color, or material.",
      overlayPolicy: "If dimension text is needed, image2 renders only verified exact measurements; do not invent rulers, labels, or numbers.",
      qaChecks: [
        "product scale feels believable",
        "no rendered ruler or dimension numbers",
        "shape and proportions match product facts",
        "thumbnail is clean enough for listing use",
      ],
    };
  }

  if (needsUseHint) {
    return {
      strategyName: "use_hint_main",
      objective: "Add a light usage or placement clue without turning the main image into a detail-page lifestyle scene.",
      thumbnailPromise: "The shopper can understand what the product is and where or how it is used.",
      selectionReason: "The category needs usage recognition, but the main image must still prioritize product identity.",
      subjectRatio: "Product should fill about 70-84% of the frame; the use cue stays in the background or edge.",
      backgroundPolicy: "Clean light studio or very minimal environment hint; avoid full room storytelling.",
      propPolicy: "One or two scale/use props are allowed only if they clarify use and remain secondary.",
      cropPolicy: "Product complete, centered or slightly offset, with no important part cropped.",
      anglePolicy: "Natural retail angle that makes the product silhouette immediately readable.",
      lightingPolicy: "Soft commercial light with realistic shadows and material highlights.",
      overlayPolicy: "No generated text unless exact allowed text is provided to image2.",
      qaChecks: [
        "product identity is readable before the usage prop",
        "background does not become a lifestyle scene",
        "use cue answers the category's main shopper question",
        "no fake text or decorative clutter",
      ],
    };
  }

  if (hasGiftIntent) {
    return {
      strategyName: "gift_main",
      objective: "Make the product feel giftable while still behaving like a marketplace main image.",
      thumbnailPromise: "This product is presentable as a gift and still clearly identifiable.",
      selectionReason: "Gift-related intent appears after stronger pack, scale, and use checks.",
      subjectRatio: "Product should fill about 68-82% of the frame; gift cue stays secondary.",
      backgroundPolicy: "Light neutral studio background with subtle warm tone; avoid busy holiday scenes.",
      propPolicy: "One restrained gift cue is allowed, such as neutral ribbon, tissue, or box edge, but no invented brand text.",
      cropPolicy: "Full product visible with safe margins for marketplace crop.",
      anglePolicy: "Premium three-quarter product angle or front angle that preserves shape accuracy.",
      lightingPolicy: "Soft warm commercial lighting, clean shadows, realistic material highlights.",
      overlayPolicy: "No rendered greeting, brand, price, or badge text unless exact allowed text is provided to image2.",
      qaChecks: [
        "product remains the largest and clearest object",
        "gift cue does not hide product facts",
        "no fake branding or greeting text",
        "main image still works as a listing thumbnail",
      ],
    };
  }

  return {
    strategyName: productStrategy.strategyName === "universal-ecommerce-proof" ? "identity_main" : "premium_main",
    objective: "Maximize instant product recognition on a marketplace listing page.",
    thumbnailPromise: "The shopper can identify the exact product at a glance.",
    selectionReason: "No stronger pack, scale, use, or gift need was detected, so identity clarity wins.",
    subjectRatio: "Product should fill about 75-88% of the square frame.",
    backgroundPolicy: "Pure white, warm white, or very light neutral studio background.",
    propPolicy: "No props unless the product cannot be understood without one.",
    cropPolicy: "Full product visible, crop-safe margins on every side.",
    anglePolicy: "Front or mild three-quarter angle that shows the complete form.",
    lightingPolicy: "Soft diffused studio lighting with crisp edges and realistic material.",
    overlayPolicy: "No generated text, badges, logos, watermarks, price graphics, or claim graphics.",
    qaChecks: [
      "product can be recognized in one second",
      "product fills the frame without clipping",
      "color, material, and shape match the reference",
      "no fake text or props distract from the product",
    ],
  };
}

type ProductVisualStrategy = {
  strategyName: string;
  categoryPattern: string;
  identityRules: string[];
  categoryGuardrails: string[];
  scaleCues: string[];
  buyerQuestions: string[];
  useSceneAction?: string;
  proofRequirements: Partial<Record<string, string[]>>;
  storyboardNotes: string[];
};

type ImageTypeProofRole = {
  proofType: string;
  storyIntent: string;
  shopperQuestion: string;
  conversionRole: string;
};

const IMAGE_TYPE_PROOF_ROLES: Record<string, ImageTypeProofRole> = {
  main: {
    proofType: "identity_proof",
    storyIntent: "Make shoppers recognize what the product is within one second.",
    shopperQuestion: "Is this the exact product I want?",
    conversionRole: "first-click clarity",
  },
  features: {
    proofType: "benefit_proof",
    storyIntent: "Turn the strongest selling points into visible product evidence.",
    shopperQuestion: "Why is this product better or useful?",
    conversionRole: "benefit comprehension",
  },
  closeup: {
    proofType: "material_detail_proof",
    storyIntent: "Show real material, workmanship, edge, surface, or construction details.",
    shopperQuestion: "Does it look well made?",
    conversionRole: "quality reassurance",
  },
  dimensions: {
    proofType: "scale_proof",
    storyIntent: "Prepare a clean base for exact size and proportion explanation.",
    shopperQuestion: "How big is it in real life?",
    conversionRole: "reduce size misunderstanding",
  },
  lifestyle: {
    proofType: "use_case_proof",
    storyIntent: "Show the product being used or placed in a natural real-life moment.",
    shopperQuestion: "How would I use it at home or in daily life?",
    conversionRole: "usage imagination",
  },
  packaging: {
    proofType: "delivery_gift_proof",
    storyIntent: "Show how the product arrives, stores, or feels gift-ready without fake branding.",
    shopperQuestion: "Will it arrive safely and feel presentable?",
    conversionRole: "delivery and gifting confidence",
  },
  comparison: {
    proofType: "choice_proof",
    storyIntent: "Create a clean base for a fair comparison without rendered claim text.",
    shopperQuestion: "What makes this a better choice?",
    conversionRole: "choice simplification",
  },
  lifestyle2: {
    proofType: "operation_proof",
    storyIntent: "Show a second use moment that proves operation, handling, wearing, mounting, or setup.",
    shopperQuestion: "Is it easy and believable to use?",
    conversionRole: "practical confidence",
  },
  scene_a: {
    proofType: "objection_proof",
    storyIntent: "Answer one purchase doubt through a believable scene, not a text-heavy poster.",
    shopperQuestion: "What could go wrong, and does this image reassure me?",
    conversionRole: "risk reduction",
  },
  scene_b: {
    proofType: "context_fit_proof",
    storyIntent: "Show a second context that proves the product fits more than one buyer situation.",
    shopperQuestion: "Will this fit my room, routine, style, body, or use case?",
    conversionRole: "broader fit",
  },
};

function getImageTypeProofRole(imageType: string): ImageTypeProofRole {
  return IMAGE_TYPE_PROOF_ROLES[imageType] || {
    proofType: "context_fit_proof",
    storyIntent: "Show the product in a believable commercial context.",
    shopperQuestion: "Can I understand the product value quickly?",
    conversionRole: "general conversion support",
  };
}

function isUseSceneImageType(imageType: string) {
  return imageType === "lifestyle" || imageType === "lifestyle2" || imageType === "scene_a" || imageType === "scene_b";
}

function isOperationSceneImageType(imageType: string) {
  return imageType === "lifestyle2" || imageType === "scene_a" || imageType === "scene_b";
}

function buildUsageSceneMandate(strategy: ProductVisualStrategy, imageType: string) {
  if (!isUseSceneImageType(imageType)) {
    return {
      requiredElements: [] as string[],
      forbiddenElements: [] as string[],
      sceneNote: "",
      humanAction: undefined as string | undefined,
      overlayNote: "",
    };
  }

  const action = strategy.useSceneAction
    || "Show a real interaction with the product according to its primary function: hand, body, pet, device, surface, room, vehicle, or tool context must visibly interact with the product.";
  const operationStep = isOperationSceneImageType(imageType)
    ? "Show a clear operation step such as holding, applying, wearing, mounting, opening, connecting, placing, storing, cleaning, repairing, organizing, or using the product."
    : "Show the product being actively used in a natural buyer scenario, not merely placed as a prop.";

  return {
    requiredElements: [
      "USAGE SCENE MANDATE: this must be an active-use scene, not a static placement scene.",
      action,
      operationStep,
      "The product must remain the hero while the hand, person, pet, device, room, vehicle, or surface proves real use.",
      "The use action must be visually understandable without relying on generated text.",
    ],
    forbiddenElements: [
      "product-only still life presented as a use scene",
      "product just sitting near unrelated props",
      "background-only lifestyle atmosphere without visible interaction",
      "model or environment becoming more important than the sellable product",
      "fake text used to explain the use case",
    ],
    sceneNote: "Active-use proof required: show the product doing its real job in context, with visible interaction and clear buyer relevance.",
    humanAction: action,
    overlayNote: "Use-scene labels are image2-only and should be omitted unless exact allowed copy is provided; the image must already show the usage action visually.",
  };
}

function buildProductVisualStrategy(analysis: ImageStudioAnalysis): ProductVisualStrategy {
  const text = buildAnalysisSearchText(analysis);
  const isMirror = /mirror|wall\s*mirror|vanity\s*mirror|decorative\s*mirror|镜|壁镜|装饰镜/.test(text);
  const isHomeDecor = isMirror || /home\s*decor|decor|wall|bedroom|bathroom|entryway|vanity|room|家居|装饰|墙面|卧室|浴室|玄关|梳妆/.test(text);
  const isWearable = /wear|apparel|clothing|shoe|bag|jewelry|necklace|ring|bracelet|earring|watch|服装|鞋|包|首饰|项链|戒指|手链|耳环|手表/.test(text);
  const isKitchenBathTool = /kitchen|bath|clean|storage|tool|organizer|rack|holder|厨|浴|清洁|收纳|工具|架|置物/.test(text);
  const isElectronics = /electronic|gadget|phone|charger|cable|adapter|led|light|lamp|speaker|earbud|keyboard|mouse|camera|stand|电子|数码|手机|充电|数据线|转接|灯|台灯|耳机|音箱|键盘|鼠标|摄像|支架/.test(text);
  const isBeautyCare = /beauty|makeup|cosmetic|skin|hair|brush|comb|nail|personal\s*care|美容|美妆|化妆|护肤|头发|梳|刷|指甲|个护/.test(text);
  const isToyKids = /toy|kids|baby|child|toddler|play|doll|puzzle|learning|玩具|儿童|婴儿|宝宝|益智|娃娃|拼图|早教/.test(text);
  const isPet = /pet|dog|cat|puppy|kitten|bird|aquarium|宠物|猫|狗|犬|鸟|水族|鱼缸/.test(text);
  const isAutoCare = /scratch|scratches|scratch\s*remover|repair\s*(cream|paste|compound)|polish|detailing|wax|car\s*care|paint\s*repair|划痕|修复膏|补漆|车漆|抛光|打蜡|汽车养护|汽车美容/.test(text);
  const isAutoOutdoor = /car|auto|vehicle|bike|camp|outdoor|garden|sport|travel|汽车|车载|车辆|自行车|露营|户外|花园|园艺|运动|旅行/.test(text);

  if (isMirror) {
    return {
      strategyName: "mirror-reflection-proof",
      categoryPattern: "mirror or reflective home decor",
      identityRules: [
        "The product must read as a real mirror with a believable reflective surface.",
        "If a use scene is requested, the mirror should prove utility through reflection, not just wall decoration.",
      ],
      categoryGuardrails: [
        "do not turn the mirror into an unrelated wall art object",
        "do not make the mirror surface empty or opaque in use-proof scenes",
        "do not make the product scale inconsistent with the analyzed dimensions",
      ],
      scaleCues: ["vanity table", "bathroom sink", "entry shelf", "lamp", "perfume bottle", "book", "plant pot"],
      buyerQuestions: [
        "Can I actually use this as a mirror?",
        "Where can I place or mount it?",
        "Is the reflection clear and the scale believable?",
      ],
      useSceneAction: "Show one ordinary adult naturally using the mirror, with the mirror surface showing a soft face or upper-face reflection.",
      proofRequirements: {
        use_case_proof: [
          "show a person naturally using the mirror",
          "show the person's face or upper face softly reflected inside the mirror",
        ],
        operation_proof: [
          "show checking makeup, earrings, hair, or outfit details",
          "keep the user secondary and the mirror as hero product",
        ],
        scale_proof: ["use familiar furniture or vanity objects to prove the mirror size"],
        objection_proof: ["answer scale, mounting, or reflection clarity through the scene"],
      },
      storyboardNotes: [
        "Mirror scenes must include reflection proof when the image type is about usage.",
        "Decor atmosphere is useful, but utility proof is the differentiator.",
      ],
    };
  }

  if (isBeautyCare) {
    return {
      strategyName: "beauty-care-result-proof",
      categoryPattern: "beauty, grooming, cosmetics, or personal care product",
      identityRules: [
        "The product must keep its exact container, applicator, surface, color, and use scale.",
        "Use scenes should prove grooming or care context without inventing medical results or exaggerated before-after claims.",
      ],
      categoryGuardrails: [
        "do not create fake clinical claims, certification marks, or miracle effects",
        "do not obscure the applicator, brush, bottle, or tool shape that explains the product",
        "do not render tiny ingredient, dosage, or label text inside the image",
      ],
      scaleCues: ["hand", "vanity tray", "bathroom counter", "makeup brush", "mirror edge", "towel"],
      buyerQuestions: [
        "How do I use it?",
        "What part touches skin, hair, nails, or the vanity setup?",
        "Does the material and finish feel clean and trustworthy?",
      ],
      useSceneAction: "Show a hand or person naturally applying, holding, brushing, grooming, opening, or using the product in a clean care routine.",
      proofRequirements: {
        benefit_proof: ["show the product's use mechanism or finish quality as visible evidence"],
        use_case_proof: ["show a natural grooming, makeup, skincare, hair, or nail care moment"],
        material_detail_proof: ["show applicator, bristles, surface, cap, edge, texture, or container detail"],
        objection_proof: ["avoid exaggerated beauty outcomes; prove ease of use and hygiene visually"],
      },
      storyboardNotes: ["Beauty and personal-care images need clean handling proof more than text-heavy claim posters."],
    };
  }

  if (isElectronics) {
    return {
      strategyName: "electronics-function-proof",
      categoryPattern: "consumer electronics, phone accessory, lighting, cable, or gadget",
      identityRules: [
        "The product must preserve ports, buttons, screens, cable ends, connectors, LEDs, and accessory geometry.",
        "Use scenes should prove compatibility, function, and scale without adding unsupported brands or UI screens.",
      ],
      categoryGuardrails: [
        "do not add fake brand logos, app interfaces, certification marks, or compatibility badges",
        "do not change connector type, port count, cable length, screen layout, or button placement",
        "do not create unsafe charging, heat, water, or electrical scenes",
      ],
      scaleCues: ["hand", "desk", "socket", "keyboard", "monitor", "nightstand", "verified compatible device only"],
      buyerQuestions: [
        "What device or situation is it for?",
        "Where are the ports, buttons, lights, or connectors?",
        "Does it look compatible, compact, and easy to use?",
      ],
      useSceneAction: "Show the product actively connected, held, switched on, mounted, adjusted, charging, supporting, lighting, or interacting with a compatible device.",
      proofRequirements: {
        benefit_proof: ["show the functional part that explains the benefit, such as connector, light, stand angle, button, or port"],
        use_case_proof: ["show the product being plugged in, held, mounted, placed, or used with a compatible device"],
        operation_proof: ["show interaction with ports, switch, cable routing, stand angle, light direction, or device placement"],
        scale_proof: ["use device, hand, or desk scale cues without adding fake interface text"],
      },
      storyboardNotes: ["Electronics images must protect function accuracy: connector, port, button, cable, and scale cannot drift."],
    };
  }

  if (isWearable) {
    return {
      strategyName: "wearable-fit-proof",
      categoryPattern: "wearable, fashion, accessory, or jewelry",
      identityRules: [
        "The product must keep its exact color, silhouette, material, and wearable scale.",
        "Use-body or model context should prove fit and styling without overpowering the product.",
      ],
      categoryGuardrails: [
        "do not change the product into a different style or material",
        "do not hide important fit or closure details",
        "do not use unrealistic body proportions or unsafe wearing contexts",
      ],
      scaleCues: ["hand", "wrist", "ear", "neckline", "shoe box", "hanger", "mirror", "outfit detail"],
      buyerQuestions: [
        "How does it look when worn?",
        "What is the real size or fit?",
        "Does the material look premium enough?",
      ],
      useSceneAction: "Show the product being worn, carried, fastened, adjusted, held, styled, or put on naturally with the relevant body part or outfit context visible.",
      proofRequirements: {
        use_case_proof: ["show the product worn or carried naturally", "include fit and styling context"],
        operation_proof: ["show clasp, strap, closure, handle, or how it is put on if relevant"],
        scale_proof: ["use body part or common accessory scale cue"],
      },
      storyboardNotes: ["Wearable products need fit proof, material proof, and styling proof."],
    };
  }

  if (isToyKids) {
    return {
      strategyName: "toy-play-safety-proof",
      categoryPattern: "toy, baby, kids, puzzle, or learning product",
      identityRules: [
        "The product must keep its real shape, pieces, colors, count, and play mechanism.",
        "Scenes should prove play value, scale, and age-appropriate context without unsafe or misleading claims.",
      ],
      categoryGuardrails: [
        "do not invent extra pieces, small parts, batteries, sounds, or learning claims",
        "do not show unsafe use, choking risk emphasis, or unattended risky baby scenes",
        "do not render fake age labels, warning labels, or certification marks",
      ],
      scaleCues: ["adult hand", "child hand", "play mat", "table", "storage box", "bedroom shelf"],
      buyerQuestions: [
        "What does the child do with it?",
        "How many pieces or parts are included?",
        "Is the size and play situation understandable?",
      ],
      useSceneAction: "Show safe play or parent-assisted interaction where hands naturally assemble, hold, press, stack, sort, or play with the product.",
      proofRequirements: {
        benefit_proof: ["show the play mechanism or learning interaction as visible evidence"],
        use_case_proof: ["show a safe play moment with the product as the hero"],
        scale_proof: ["use hand, table, mat, or storage cue to show real size"],
        objection_proof: ["avoid fake safety or education claims; prove simplicity and included parts visually"],
      },
      storyboardNotes: ["Toy and kids products need play proof, scale proof, and part-count clarity."],
    };
  }

  if (isPet) {
    return {
      strategyName: "pet-use-proof",
      categoryPattern: "pet supply, dog, cat, bird, or aquarium product",
      identityRules: [
        "The product must keep its real size, shape, material, entry points, fasteners, openings, or texture.",
        "Pet scenes should prove scale and usage without making the pet more important than the product.",
      ],
      categoryGuardrails: [
        "do not show unsafe restraint, feeding, grooming, or enclosure use",
        "do not invent pet sizes, capacity, materials, or veterinary claims",
        "do not hide the functional surface, opening, buckle, bowl, bed, toy, or connector",
      ],
      scaleCues: ["cat", "small dog", "hand", "floor", "sofa edge", "food bowl", "pet bed"],
      buyerQuestions: [
        "Will it fit my pet?",
        "How does the pet use or interact with it?",
        "Does the material look comfortable and practical?",
      ],
      useSceneAction: "Show a calm pet naturally entering, lying on, eating from, wearing, playing with, scratching, or interacting with the product while the product stays prominent.",
      proofRequirements: {
        benefit_proof: ["show the pet-facing function, texture, opening, grip, capacity, or comfort cue"],
        use_case_proof: ["show a calm pet interaction where the product remains the hero"],
        scale_proof: ["use pet body, hand, floor, or furniture scale cues"],
        objection_proof: ["avoid unsafe pet handling and unsupported health claims"],
      },
      storyboardNotes: ["Pet products need fit, safety, and usage proof with the product visually dominant."],
    };
  }

  if (isAutoCare) {
    return {
      strategyName: "auto-care-repair-proof",
      categoryPattern: "automotive care, scratch repair, polish, wax, detailing, or paint maintenance product",
      identityRules: [
        "The product must preserve the real container, applicator, paste, liquid, sponge, cloth, or repair material shown in the references.",
        "Use scenes should prove the product's automotive care action on a real vehicle surface without inventing impossible repair results.",
      ],
      categoryGuardrails: [
        "do not invent certification marks, car brand logos, professional-grade claims, or miracle before-after effects",
        "do not hide the product container, paste, sponge, microfiber cloth, nozzle, applicator, or use surface",
        "do not show unsafe driving, engine work, or unrelated car-repair tools unless present in the references",
      ],
      scaleCues: ["hand", "microfiber cloth", "sponge pad", "car door panel", "bumper", "paint scratch", "garage work surface"],
      buyerQuestions: [
        "Where do I apply it?",
        "How do I use it on the car surface?",
        "Does the action look simple, believable, and non-messy?",
      ],
      useSceneAction: "Show a hand using a fingertip, sponge pad, or microfiber cloth to apply the product onto a visible car paint scratch or scuff, with the product container open and nearby.",
      proofRequirements: {
        benefit_proof: ["show the product touching the vehicle surface as visible repair/cleaning evidence"],
        use_case_proof: ["show a realistic car-care moment: hand, applicator, product, and scratched paint surface in one coherent scene"],
        operation_proof: ["show the application step clearly: scoop, apply, rub, polish, wipe, or buff the product on the scratch"],
        objection_proof: ["avoid fake perfect restoration; show believable touch-up use and surface care"],
        scale_proof: ["use hand, cloth, sponge, car panel, or jar size cues"],
      },
      storyboardNotes: ["Automotive care products need action proof on the vehicle surface; a jar beside car props is not enough."],
    };
  }

  if (isAutoOutdoor) {
    return {
      strategyName: "auto-outdoor-fit-proof",
      categoryPattern: "automotive, travel, camping, garden, outdoor, or sports product",
      identityRules: [
        "The product must preserve mounting points, straps, clamps, handles, surface texture, and rugged details.",
        "Scenes should prove fit, placement, weather context, or carrying use without exaggerating durability claims.",
      ],
      categoryGuardrails: [
        "do not invent vehicle brands, warning labels, certifications, waterproof ratings, or load capacity",
        "do not create unsafe driving, installation, sports, or outdoor use scenes",
        "do not hide the part that proves mounting, carrying, grip, or fit",
      ],
      scaleCues: ["hand", "car interior", "trunk", "bike handlebar", "backpack", "camp table", "garden tool"],
      buyerQuestions: [
        "Where does it fit or mount?",
        "How big and portable is it?",
        "Does it look practical in the intended environment?",
      ],
      useSceneAction: "Show the product being mounted, placed, opened, folded, carried, gripped, applied, cleaned, organized, or used safely in a car, outdoor, travel, garden, or sport context.",
      proofRequirements: {
        benefit_proof: ["show the fit, mounting, carrying, grip, or weather-context function as visible evidence"],
        use_case_proof: ["show a realistic car, outdoor, travel, garden, or sports context with safe handling"],
        operation_proof: ["show attaching, placing, carrying, opening, folding, gripping, or organizing if relevant"],
        scale_proof: ["use vehicle, hand, backpack, table, or outdoor gear scale cues"],
      },
      storyboardNotes: ["Auto and outdoor products need fit proof and safe practical context, not over-stylized adventure scenes."],
    };
  }

  if (isHomeDecor && !isKitchenBathTool) {
    return {
      strategyName: "home-placement-proof",
      categoryPattern: "home decor or room object",
      identityRules: [
        "The product must stay recognizable as the same home object across rooms.",
        "Room scenes should prove placement, scale, and style compatibility.",
      ],
      categoryGuardrails: [
        "do not let room decoration overpower the product",
        "do not inflate the product into an unrealistic centerpiece",
        "do not invent unsupported functional claims",
      ],
      scaleCues: ["bedside table", "sofa", "sink", "entry console", "shelf", "lamp", "book", "vase"],
      buyerQuestions: [
        "Where can I put it?",
        "Will the size fit my room?",
        "Does it match common home styles?",
      ],
      useSceneAction: "Show the product installed, placed, held, arranged, opened, lit, stored, or interacted with in a real room so shoppers understand placement and scale.",
      proofRequirements: {
        use_case_proof: ["show a real room placement with clear scale cues"],
        context_fit_proof: ["show a second room or decor style distinct from the first"],
        scale_proof: ["keep familiar furniture nearby to communicate size"],
      },
      storyboardNotes: ["Home goods need placement proof and scale proof more than abstract beauty shots."],
    };
  }

  if (isKitchenBathTool) {
    return {
      strategyName: "utility-operation-proof",
      categoryPattern: "kitchen, bathroom, storage, cleaning, or tool product",
      identityRules: [
        "The product must be shown as a practical physical item with clear use mechanics.",
        "Use scenes should prove operation, installation, cleaning, storage, or daily convenience.",
      ],
      categoryGuardrails: [
        "do not make the use case unsafe or impossible",
        "do not exaggerate capacity, strength, waterproofing, or durability",
        "do not hide the part that explains how it works",
      ],
      scaleCues: ["hand", "countertop", "sink", "cabinet", "bottle", "towel", "drawer", "wall hook"],
      buyerQuestions: [
        "How does it work?",
        "Will it fit my space?",
        "Is it easy to install, clean, or store?",
      ],
      useSceneAction: "Show hands or a real household surface actively using, installing, opening, cleaning, storing, pouring, hanging, mounting, or organizing with the product.",
      proofRequirements: {
        use_case_proof: ["show the product performing its daily job"],
        operation_proof: ["show hands, installation, opening, mounting, folding, pouring, or storage action if relevant"],
        scale_proof: ["show countertop, sink, cabinet, or hand scale cues"],
      },
      storyboardNotes: ["Utility products need action proof and space-fit proof before beauty."],
    };
  }

  return {
    strategyName: "universal-ecommerce-proof",
    categoryPattern: "generic retail product",
    identityRules: [
      "The product must remain the same object across every image.",
      "Every image should answer one shopper question through visible evidence.",
    ],
    categoryGuardrails: [
      "do not invent unsupported features",
      "do not change product category, count, material, or core shape",
      "do not rely on rendered text to explain the value",
    ],
    scaleCues: ["hand", "table", "shelf", "packaging", "common everyday object"],
    buyerQuestions: [
      "What exactly is it?",
      "How do I use it?",
      "How big is it?",
      "Why should I choose it?",
    ],
    useSceneAction: "Show a real buyer-relevant interaction with the product: a hand, body, device, pet, surface, room, vehicle, or tool context must visibly use the product for its intended job.",
    proofRequirements: {
      identity_proof: ["keep the complete product visible and instantly recognizable"],
      benefit_proof: ["turn selling points into visible product evidence, not text"],
      use_case_proof: ["show a natural use or placement moment"],
      scale_proof: ["use familiar objects or body cues to prove size"],
      operation_proof: ["show handling or setup if the product has a use mechanism"],
      choice_proof: ["show a clean comparison-ready base without claim text"],
    },
    storyboardNotes: ["The default system is proof-first: each image must answer one buyer doubt visually."],
  };
}

function applyProductVisualStrategyToBlueprint(
  blueprint: ShotBriefBlueprint,
  imageType: string,
  strategy: ProductVisualStrategy,
): ShotBriefBlueprint {
  const role = getImageTypeProofRole(imageType);
  const proofRequirements = strategy.proofRequirements[role.proofType] || [];
  const usageMandate = buildUsageSceneMandate(strategy, imageType);

  return {
    ...blueprint,
    categoryStrategy: strategy.strategyName,
    proofType: role.proofType,
    storyIntent: role.storyIntent,
    shopperQuestion: role.shopperQuestion,
    conversionRole: role.conversionRole,
    purpose: `${role.storyIntent} ${blueprint.purpose}`,
    scene: compactShotList([blueprint.scene, usageMandate.sceneNote]).join(" "),
    humanAction: blueprint.humanAction || usageMandate.humanAction,
    requiredElements: compactShotList([
      strategy.identityRules,
      proofRequirements,
      usageMandate.requiredElements,
      blueprint.requiredElements,
    ]),
    forbiddenElements: compactShotList([
      strategy.categoryGuardrails,
      usageMandate.forbiddenElements,
      blueprint.forbiddenElements,
    ]),
    overlayNotes: compactShotList([
      blueprint.overlayNotes || [],
      strategy.storyboardNotes,
      `This image is ${role.proofType}; answer: ${role.shopperQuestion}`,
      usageMandate.overlayNote,
    ]),
  };
}

function applyMainImageStrategyToBlueprint(
  blueprint: ShotBriefBlueprint,
  mainStrategy: ImageStudioMainImageStrategy,
): ShotBriefBlueprint {
  return {
    ...blueprint,
    purpose: `${mainStrategy.objective} ${blueprint.purpose}`,
    scene: [
      "Marketplace main image setup.",
      mainStrategy.backgroundPolicy,
      `Thumbnail promise: ${mainStrategy.thumbnailPromise}`,
    ].join(" "),
    composition: [
      mainStrategy.subjectRatio,
      mainStrategy.cropPolicy,
      "The product identity must win before mood, props, or environment.",
    ].join(" "),
    camera: mainStrategy.anglePolicy,
    lighting: mainStrategy.lightingPolicy,
    style: [
      blueprint.style,
      "listing-thumbnail-first commercial product photography",
      "clean, credible, click-worthy, not a detail-page infographic",
    ].join(", "),
    requiredElements: compactShotList([
      blueprint.requiredElements,
      `MainImageStrategy: ${mainStrategy.strategyName}.`,
      `Prop policy: ${mainStrategy.propPolicy}`,
      `Overlay policy: ${mainStrategy.overlayPolicy}`,
      mainStrategy.qaChecks.map((item) => `Main image QA: ${item}`),
    ]),
    forbiddenElements: compactShotList([
      blueprint.forbiddenElements,
      "detail-page collage layout",
      "busy lifestyle storytelling",
      "large blocks of generated text",
      "props that become more important than the product",
      "cropped product edges",
    ]),
    overlayNotes: compactShotList([
      blueprint.overlayNotes || [],
      mainStrategy.overlayPolicy,
      mainStrategy.qaChecks.map((item) => `QA check: ${item}`),
    ]),
  };
}

function limitShotBriefText(value: string, maxLength = 4200) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function buildShotBriefProductFacts(analysis: ImageStudioAnalysis, isBlackHeartMirror: boolean) {
  return compactShotList([
    analysis.category ? `Category: ${analysis.category}` : "",
    analysis.materials ? `Materials: ${analysis.materials}` : "",
    analysis.colors ? `Colors: ${analysis.colors}` : "",
    analysis.estimatedDimensions ? `Estimated dimensions: ${analysis.estimatedDimensions}` : "",
    analysis.productFacts?.productForm ? `Product form: ${analysis.productFacts.productForm}` : "",
    analysis.productFacts?.countAndConfiguration ? `Configuration: ${analysis.productFacts.countAndConfiguration}` : "",
    analysis.productFacts?.mountingPlacement ? `Mounting or placement: ${analysis.productFacts.mountingPlacement}` : "",
    analysis.productFacts?.packagingEvidence ? `Packaging evidence: ${analysis.productFacts.packagingEvidence}` : "",
    analysis.operatorInsights?.usageActions?.length ? `Usage actions: ${analysis.operatorInsights.usageActions.join("; ")}` : "",
    analysis.operatorInsights?.proofPoints?.length ? `Proof points: ${analysis.operatorInsights.proofPoints.join("; ")}` : "",
    analysis.creativeDirection?.aPlusStory ? `A+ story: ${analysis.creativeDirection.aPlusStory}` : "",
    isBlackHeartMirror
      ? "Identity lock: small black heart-shaped decorative mirror with a carved ornamental sunburst/baroque frame."
      : "",
    analysis.productFacts?.factGuardrails || [],
  ]);
}

function buildShotBriefProductIdentity(analysis: ImageStudioAnalysis) {
  const isBlackHeartMirror = isBlackHeartMirrorProduct(analysis);
  const productName = normalizeProductDisplayName(analysis.productName)
    || analysis.productFacts?.productName
    || analysis.category
    || "Product";

  if (isBlackHeartMirror) {
    return [
      "Small black heart-shaped decorative mirror.",
      "It has a carved ornamental sunburst/baroque frame, a reflective heart mirror center, and a compact vintage/gothic romantic accent scale.",
      "It is suitable for gift, vanity table, bedroom, entryway, and wall decor scenes.",
    ].join(" ");
  }

  return compactShotList([
    productName,
    analysis.category,
    analysis.materials,
    analysis.colors,
  ]).join(". ");
}

function buildShotBriefBlueprint(imageType: string, isBlackHeartMirror: boolean): ShotBriefBlueprint {
  const baseForbidden = [
    "fake or misspelled text",
    "readable product-label text invented by the model",
    "readable container copy invented by the model",
    "readable packaging copy invented by the model",
    "tiny labels",
    "dimension numbers rendered by the image model",
    "UI tags, badges, logos, watermarks, price tags, or pseudo-typography",
    "unverifiable claims",
    "wrong product shape, color, material, or scale",
  ];

  if (imageType === "main") {
    return {
      purpose: "Create a marketplace hero image that makes the product identity instantly clear.",
      scene: "Clean e-commerce product setup with a premium neutral surface or simple studio environment.",
      composition: "Product centered or slightly elevated, full product visible, enough breathing room for marketplace crop safety.",
      camera: "Front-facing or mild three-quarter product angle, natural retail perspective, no extreme crop.",
      lighting: "Soft commercial studio lighting with clear edge definition and controlled reflections.",
      style: "Professional cross-border marketplace hero product photography, realistic materials, crisp details.",
      requiredElements: [
        "hero product is complete and recognizable",
        "clear product silhouette",
        "accurate product color and material",
      ],
      forbiddenElements: baseForbidden,
      overlayPlacement: "top corner or lower corner",
      overlayNotes: ["Keep a clean corner if image2 is asked to render an exact pack-count or offer badge."],
    };
  }

  if (imageType === "features") {
    return {
      purpose: "Create a feature-ready image where any text must be rendered directly by image2 from exact allowed copy.",
      scene: "Clean product-forward setup with subtle props only when they help explain the product.",
      composition: "Balanced product composition with negative space for later callouts, no dense infographic text.",
      camera: "Medium product angle with enough depth to show form and important features.",
      lighting: "Soft directional light that reveals material, relief, and shape.",
      style: "Clear e-commerce feature image, polished but not poster-like.",
      requiredElements: isBlackHeartMirror
        ? ["black heart mirror", "carved ornamental border", "visible reflective heart center"]
        : ["complete product", "visible key features"],
      forbiddenElements: baseForbidden,
      overlayPlacement: "left or right empty area",
      overlayNotes: ["Feature copy is image2-only and must stay short, exact, and readable if used."],
    };
  }

  if (imageType === "closeup") {
    return {
      purpose: "Show material and craftsmanship details with a close-up product view.",
      scene: "Tight but realistic product detail setup on a clean surface.",
      composition: "Close-up framing that still keeps the product detail readable and believable.",
      camera: "Macro or close product lens, shallow depth of field only if it does not hide important detail.",
      lighting: "Controlled side light to reveal texture, carved edges, and reflective surfaces.",
      style: "Realistic detail photography with premium material texture.",
      requiredElements: isBlackHeartMirror
        ? ["carved black frame detail", "heart mirror edge", "real reflective surface"]
        : ["material texture", "important construction detail"],
      forbiddenElements: baseForbidden,
      overlayPlacement: "small empty margin",
      overlayNotes: ["Detail labels are image2-only and should be omitted unless exact allowed copy is provided."],
    };
  }

  if (imageType === "dimensions") {
    return {
      purpose: "Create a clean dimension-ready base image for later precise size annotation.",
      scene: "Minimal product setup with blank margins and simple scale context.",
      composition: "Product centered or slightly offset with clear empty space on left, right, and bottom for size lines.",
      camera: "Straight-on front view or mild top-down view that makes proportions easy to understand.",
      lighting: "Even soft light with minimal shadow clutter.",
      style: "Clean catalog dimension base, not a finished infographic.",
      requiredElements: isBlackHeartMirror
        ? ["compact small decorative accent scale", "full black heart mirror visible"]
        : ["full product visible", "believable physical scale"],
      forbiddenElements: [...baseForbidden, "rulers", "measurement arrows", "hands", "decorative clutter"],
      overlayPlacement: "left, right, and bottom",
      overlayNotes: ["Precise numbers, arrows, and measurement lines are image2-only and must use verified dimensions only."],
    };
  }

  if (imageType === "packaging") {
    return {
      purpose: "Show a gift-ready or shipping-ready product presentation without inventing brand text.",
      scene: "Neutral protective packaging, tissue paper, gift box, or unboxing surface with the product still visible.",
      composition: "Product and packaging arranged clearly, no fake brand label, no cluttered copy.",
      camera: "Slight top-down or three-quarter unboxing angle.",
      lighting: "Soft warm commercial light, clean shadows.",
      style: "Realistic gift/unboxing e-commerce photography.",
      requiredElements: isBlackHeartMirror
        ? ["black heart mirror visible", "neutral gift-ready box or protective wrapping"]
        : ["product visible", "neutral packaging or protective wrapping"],
      forbiddenElements: [...baseForbidden, "invented brand names", "fake shipping labels"],
      overlayPlacement: "empty package-side margin",
      overlayNotes: ["Any gift or packaging text is image2-only and must use exact allowed copy only."],
    };
  }

  if (imageType === "comparison") {
    return {
      purpose: "Create a restrained comparison-ready base image without rendered comparison text.",
      scene: "Two clean product/alternative areas with simple visual contrast and enough space for later labels.",
      composition: "Side-by-side or split composition, calm and not exaggerated.",
      camera: "Consistent product angle across both comparison areas.",
      lighting: "Even commercial light so the comparison feels fair and credible.",
      style: "Credible e-commerce comparison base, not a claim-heavy poster.",
      requiredElements: isBlackHeartMirror
        ? ["black heart mirror with stronger decorative presence", "plain generic alternative area"]
        : ["hero product", "plain generic alternative area"],
      forbiddenElements: [...baseForbidden, "Ours label", "Ordinary label", "checkmarks", "red X marks", "comparison tables"],
      overlayPlacement: "top and bottom",
      overlayNotes: ["Comparison labels and proof points are image2-only and must use exact allowed copy only."],
    };
  }

  if (isBlackHeartMirror && (imageType === "lifestyle" || imageType === "lifestyle2" || imageType === "scene_a" || imageType === "scene_b")) {
    const isSecondScene = imageType === "lifestyle2" || imageType === "scene_b";
    return {
      purpose: imageType === "lifestyle" || imageType === "lifestyle2"
        ? "Prove the decorative mirror is actually usable in a real daily moment."
        : "Create a conversion scene that shows both small-space decor value and mirror utility.",
      scene: isSecondScene
        ? "Warm vintage vanity, bedroom wall, bedside corner, or gift/decor moment with the mirror mounted or propped naturally."
        : "Realistic vanity corner, narrow entryway, dressing area, or small bedroom wall where the mirror is naturally used.",
      humanAction: "One ordinary adult naturally checks earrings, hair, makeup, or outfit details near the mirror.",
      mirrorReflection: "The mirror surface clearly contains a soft natural reflection of the person's face or upper face; the reflection proves this is a usable mirror while staying secondary to the product.",
      composition: "The black heart mirror remains the hero. The person is partially framed and natural, not a beauty-ad close-up or selfie.",
      camera: "Medium eye-level or slight three-quarter lifestyle angle, realistic home-product photography.",
      lighting: "Warm natural side light or soft vanity light with controlled mirror reflection.",
      style: "Premium realistic lifestyle e-commerce photography, cozy vintage decor, compact scale cues.",
      requiredElements: [
        "black heart-shaped decorative mirror",
        "carved black ornamental frame",
        "visible reflected face or upper face in the mirror",
        "small-space scale cues such as vanity table, lamp, perfume bottle, book, vase, or entry shelf",
      ],
      forbiddenElements: [
        ...baseForbidden,
        "direct selfie composition",
        "beauty-ad close-up",
        "distorted face",
        "extra people",
        "face filling the whole image",
        "full-length mirror",
        "large wall-scale mirror",
        "handheld mirror",
      ],
      overlayPlacement: "quiet wall or tabletop negative space",
      overlayNotes: ["Usage copy is image2-only and should be omitted unless exact allowed copy is provided."],
    };
  }

  return {
    purpose: "Create a realistic e-commerce scene that explains the product role and purchase value.",
    scene: "Believable usage environment with natural props and clear product scale.",
    composition: "Product-led composition with enough clean space for exact image2-rendered copy if needed.",
    camera: "Natural commercial photography angle, no extreme perspective.",
    lighting: "Soft realistic light that keeps the product clear.",
    style: "Professional e-commerce lifestyle photography.",
    requiredElements: ["complete product", "realistic use context", "believable scale cues"],
    forbiddenElements: baseForbidden,
    overlayPlacement: "clean negative space",
    overlayNotes: ["Promotional copy is image2-only and should be omitted unless exact allowed copy is provided."],
  };
}

function getShotBriefSourcePrompt(plan: ImageStudioPlan) {
  const existingSource = plan.shotBrief?.sourcePlanPrompt?.trim();
  if (existingSource) return existingSource;
  if (plan.promptSource === SHOT_BRIEF_PROMPT_SOURCE) return "";
  return String(plan.prompt || "").trim();
}

function getShotBriefManualEditNote(plan: ImageStudioPlan) {
  if (plan.promptSource !== SHOT_BRIEF_PROMPT_SOURCE || !plan.compiledPrompt) return "";
  const currentPrompt = String(plan.prompt || "").trim();
  const compiledPrompt = String(plan.compiledPrompt || "").trim();
  if (!currentPrompt || currentPrompt === compiledPrompt) return "";
  return `Operator edited the prompt preview. Preserve this edit intent inside the structured ShotBrief: ${limitShotBriefText(currentPrompt, 2400)}`;
}

function extractVerifiedDimensionTexts(shotBrief: ImageStudioShotBrief) {
  if (shotBrief.imageType !== "dimensions") return [];
  const dimensionFact = shotBrief.productFacts.find((fact) => /^Estimated dimensions:/i.test(fact));
  if (!dimensionFact) return [];
  const raw = dimensionFact.replace(/^Estimated dimensions:\s*/i, "").trim();
  if (!raw) return [];

  const measurements = raw.match(/\d+(?:\.\d+)?\s*(?:cm|mm|m|in|inch|inches|厘米|毫米|米|英寸)\b(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:cm|mm|m|in|inch|inches|厘米|毫米|米|英寸)\b)?/gi) || [];
  return dedupeTextList(measurements).slice(0, 4);
}

function buildImage2VisibleTextSpec(packPolicy: PackCountPolicy, shotBrief: ImageStudioShotBrief): ImageStudioVisibleTextSpec {
  const allowedText = compactShotList([
    packPolicy.allowedText,
    extractVerifiedDimensionTexts(shotBrief),
  ]);
  if (packPolicy.visibleTextMode === "none") {
    return {
      mode: "none",
      allowedText: [],
      rules: [
        "No visible text is allowed in the generated image.",
        "Do not render labels, numbers, badges, UI tags, logos, watermarks, captions, or pseudo-typography.",
        "Do not render readable letters on the product container, product label, packaging, background, or props.",
        "If the real product has a label area but exact label text is not explicitly supplied as allowed text, show it as blank color blocks or non-readable abstract graphics only.",
      ],
    };
  }

  if (allowedText.length > 0) {
    return {
      mode: "exact",
      allowedText,
      rules: [
        "All visible text must be generated directly by image2 as part of the final image. No local text-composition layer will be added.",
        ...allowedText.map((text) => `If rendered, the text must be exactly "${text}".`),
        "Render each allowed text at most once.",
        "No other visible text is allowed.",
        "Use bold, clean sans-serif lettering with high contrast and readable kerning.",
      ],
    };
  }

  return {
    mode: "none",
    allowedText: [],
    rules: [
      "No visible text is allowed because no verified exact text was provided for image2.",
      "Do not render labels, numbers, badges, UI tags, logos, watermarks, captions, arrows with captions, or pseudo-typography.",
      "Do not render readable letters on the product container, product label, packaging, background, or props; leave label areas blank or use non-readable abstract graphics.",
    ],
  };
}

function buildImage2PromptSpec(
  shotBrief: ImageStudioShotBrief,
  context: ShotBriefBuildContext,
  packPolicy: PackCountPolicy,
): ImageStudioImage2PromptSpec {
  const referenceImages = context.referenceImages?.length
    ? context.referenceImages
    : buildImage2ReferenceImages([], context.productMode, context.comboLabel);
  const productMode = context.productMode || "single";

  return {
    templateVersion: "image2-ecommerce-spec-v1",
    task: compactShotList([
      "Create an ecommerce product image for Temu marketplace.",
      `Image type: ${shotBrief.imageType}.`,
      `Purpose: ${shotBrief.purpose}`,
      `Target market: ${context.salesRegion.toUpperCase()}.`,
      `Visible language for any image2-rendered text: ${context.imageLanguage}.`,
      `Product mode: ${productMode}.`,
      context.comboLabel ? `Selected bundle label: ${context.comboLabel}.` : "",
    ]),
    referenceImages,
    productInvariants: compactShotList([
      "Preserve the real product from the reference images.",
      "Do not change the product geometry, shape, proportions, material, surface texture, color, or functional structure.",
      "Do not add new product parts, accessories, logos, labels, certifications, claims, or packaging that are not visible or explicitly described.",
      "Do not invent readable product labels, container copy, packaging copy, slogans, badges, certification marks, or claim text. If a label area is needed, keep it as blank color bands or non-readable graphic shapes.",
      "If multiple product components are provided, use only the selected sellable components.",
      "Do not treat background props, packaging, manuals, or decoration as sellable components unless explicitly marked as sellable.",
      "The sellable product is always the hero. People, rooms, hands, props, packaging, and comparison alternatives are proof context only.",
      `Product identity: ${shotBrief.productIdentity}`,
      shotBrief.productFacts,
    ]),
    imageRequirements: compactShotList([
      shotBrief.proofType ? `Proof type: ${shotBrief.proofType}.` : "",
      shotBrief.storyIntent ? `Story intent: ${shotBrief.storyIntent}` : "",
      shotBrief.shopperQuestion ? `Shopper question to answer visually: ${shotBrief.shopperQuestion}` : "",
      shotBrief.conversionRole ? `Conversion role: ${shotBrief.conversionRole}.` : "",
      shotBrief.mainImageStrategy ? `Main image strategy: ${shotBrief.mainImageStrategy.strategyName}. ${shotBrief.mainImageStrategy.objective}` : "",
      shotBrief.requiredElements,
      packPolicy.requiredElements,
      shotBrief.humanAction ? `Human action: ${shotBrief.humanAction}` : "",
      shotBrief.mirrorReflection ? `Mirror/reflection requirement: ${shotBrief.mirrorReflection}` : "",
    ]),
    composition: compactShotList([
      `Scene: ${shotBrief.scene}`,
      `Composition: ${shotBrief.composition}`,
      `Camera: ${shotBrief.camera}`,
      `Lighting: ${shotBrief.lighting}`,
      `Style: ${shotBrief.style}`,
      "Product hierarchy: product first, proof context second, atmosphere third.",
      "Avoid magazine/editorial scenes where the model, room, lighting mood, or text treatment becomes more important than the product.",
      shotBrief.mainImageStrategy ? [
        `Subject ratio: ${shotBrief.mainImageStrategy.subjectRatio}`,
        `Background policy: ${shotBrief.mainImageStrategy.backgroundPolicy}`,
        `Prop policy: ${shotBrief.mainImageStrategy.propPolicy}`,
        `Crop policy: ${shotBrief.mainImageStrategy.cropPolicy}`,
      ] : [],
      shotBrief.overlayPlan?.placement ? `Keep a clean text/callout zone if exact image2-rendered text is allowed: ${shotBrief.overlayPlan.placement}` : "",
    ]),
    visibleText: buildImage2VisibleTextSpec(packPolicy, shotBrief),
    forbidden: compactShotList([
      "No watermarks.",
      "No fake brand logos.",
      "No fake certifications.",
      "No exaggerated claims.",
      "No unapproved generated text. Any text must come from the VISIBLE TEXT exact allowed list and must be rendered directly by image2.",
      "No extra accessories or extra product variants.",
      "No distortion of the product.",
      "No scene where a person, room, prop, package, or decorative mood steals attention from the sellable product.",
      shotBrief.forbiddenElements,
      packPolicy.forbiddenElements,
    ]),
    runtime: compactShotList([
      `Image size target: ${context.imageSize}.`,
      "The ShotBrief fields are the authority; designer metadata is creative context only.",
      shotBrief.operatorNotes || [],
    ]),
  };
}

function buildShotBriefFromPlan(
  plan: ImageStudioPlan,
  analysis: ImageStudioAnalysis,
  context: ShotBriefBuildContext,
): ImageStudioShotBrief {
  const isBlackHeartMirror = isBlackHeartMirrorProduct(analysis);
  const visualStrategy = buildProductVisualStrategy(analysis);
  const mainImageStrategy = plan.imageType === "main"
    ? buildMainImageStrategy(analysis, visualStrategy, context)
    : undefined;
  const proofBlueprint = applyProductVisualStrategyToBlueprint(
    buildShotBriefBlueprint(plan.imageType, isBlackHeartMirror),
    plan.imageType,
    visualStrategy,
  );
  const blueprint = mainImageStrategy
    ? applyMainImageStrategyToBlueprint(proofBlueprint, mainImageStrategy)
    : proofBlueprint;
  const productIdentity = buildShotBriefProductIdentity(analysis);
  const productFacts = buildShotBriefProductFacts(analysis, isBlackHeartMirror);
  const sourcePlanPrompt = getShotBriefSourcePrompt(plan);
  const packCount = Math.max(1, Math.min(12, Math.floor(context.packCount || 1)));
  const packPolicy = buildImageTypePackCountPolicy(plan.imageType, packCount);
  const globalForbidden = getPlanStringList(plan, "globalForbidden");
  const designerScene = typeof plan.designerSceneDescription === "string" ? plan.designerSceneDescription.trim() : "";
  const designerMood = typeof plan.designerMood === "string" ? plan.designerMood.trim() : "";
  const manualEditNote = getShotBriefManualEditNote(plan);
  const existingOperatorNotes = Array.isArray(plan.shotBrief?.operatorNotes) ? plan.shotBrief.operatorNotes : [];

  const shotBrief: ImageStudioShotBrief = {
    version: SHOT_BRIEF_VERSION,
    targetModel: "gpt-image-2",
    imageType: plan.imageType,
    categoryStrategy: blueprint.categoryStrategy,
    proofType: blueprint.proofType,
    storyIntent: blueprint.storyIntent,
    shopperQuestion: blueprint.shopperQuestion,
    conversionRole: blueprint.conversionRole,
    mainImageStrategy,
    productIdentity,
    productFacts: compactShotList([
      productFacts,
      `Detected visual strategy: ${visualStrategy.strategyName} (${visualStrategy.categoryPattern}).`,
      mainImageStrategy ? `Main image strategy: ${mainImageStrategy.strategyName}. ${mainImageStrategy.selectionReason}` : "",
      visualStrategy.buyerQuestions.map((item) => `Buyer question: ${item}`),
      visualStrategy.scaleCues.map((item) => `Scale cue option: ${item}`),
    ]),
    purpose: blueprint.purpose,
    scene: compactShotList([designerScene, blueprint.scene]).join(" "),
    humanAction: blueprint.humanAction,
    mirrorReflection: blueprint.mirrorReflection,
    composition: blueprint.composition,
    camera: blueprint.camera,
    lighting: blueprint.lighting,
    style: compactShotList([designerMood, blueprint.style]).join(" "),
    requiredElements: compactShotList([
      blueprint.requiredElements,
      packPolicy.requiredElements,
      analysis.sellingPoints.slice(0, plan.imageType === "features" ? 4 : 2).map((item) => `Support selling point visually: ${item}`),
    ]),
    forbiddenElements: compactShotList([
      blueprint.forbiddenElements,
      globalForbidden,
      packPolicy.forbiddenElements,
      isBlackHeartMirror
        ? [
            "round mirror",
            "oval mirror",
            "gold mirror",
            "white mirror",
            "clock",
            "picture frame",
            "flower decor",
            "cosmetic product",
          ]
        : [],
    ]),
    textPolicy: [
      "Image2 owns the final artwork.",
      "Do not rely on any local text layer.",
      "Render only exact allowed text when the VISIBLE TEXT rules permit it; otherwise keep the image text-free.",
      "Do not render small text, labels, numbers, badges, logos, watermarks, price tags, captions, or pseudo-typography.",
    ].join(" "),
    overlayPlan: {
      placement: blueprint.overlayPlacement,
      allowedText: compactShotList([
        blueprint.overlayAllowedText || [],
        packPolicy.allowedText,
      ]),
      notes: compactShotList([
        blueprint.overlayNotes || [],
        packPolicy.overlayNotes,
      ]),
    },
    sourcePlanPrompt: sourcePlanPrompt ? limitShotBriefText(sourcePlanPrompt) : undefined,
    operatorNotes: compactShotList([
      existingOperatorNotes,
      `Sales region: ${context.salesRegion.toUpperCase()}.`,
      `Image size: ${context.imageSize}.`,
      `Image2 text language: ${context.imageLanguage}.`,
      manualEditNote,
      sourcePlanPrompt ? "Designer source prompt was converted into structured ShotBrief fields; do not follow its text/layout instructions directly." : "",
    ]),
  };

  return {
    ...shotBrief,
    image2Spec: buildImage2PromptSpec(shotBrief, context, packPolicy),
  };
}

function formatShotBriefList(values: string[]) {
  if (values.length === 0) return "None.";
  return values.map((item, index) => `(${index + 1}) ${item}`).join(" ");
}

function formatMainImageStrategy(strategy?: ImageStudioMainImageStrategy) {
  if (!strategy) return "";
  return [
    `Strategy: ${strategy.strategyName}.`,
    `Objective: ${strategy.objective}`,
    `Thumbnail promise: ${strategy.thumbnailPromise}`,
    `Selection reason: ${strategy.selectionReason}`,
    `Subject ratio: ${strategy.subjectRatio}`,
    `Background policy: ${strategy.backgroundPolicy}`,
    `Prop policy: ${strategy.propPolicy}`,
    `Crop policy: ${strategy.cropPolicy}`,
    `Angle policy: ${strategy.anglePolicy}`,
    `Lighting policy: ${strategy.lightingPolicy}`,
    `Overlay policy: ${strategy.overlayPolicy}`,
    `QA checks: ${formatShotBriefList(strategy.qaChecks)}`,
  ].join("\n");
}

function formatImage2ReferenceImages(referenceImages: ImageStudioReferenceImage[]) {
  if (referenceImages.length === 0) {
    return "Image 1: uploaded product reference. Use as the product identity reference.";
  }

  return referenceImages.map((image) => [
    `${image.label || `Image ${image.index}`}: ${image.role}.`,
    image.sellableComponent === true ? "Marked as sellable component." : image.sellableComponent === false ? "Not a sellable component unless explicitly required." : "",
    image.instruction,
  ].filter(Boolean).join(" ")).join("\n");
}

function formatVisibleTextSpec(spec: ImageStudioVisibleTextSpec) {
  const allowedText = spec.allowedText.length > 0
    ? spec.allowedText.map((text) => `"${text}"`).join(", ")
    : "None";
  return [
    `Mode: ${spec.mode}.`,
    `Allowed text: ${allowedText}.`,
    ...spec.rules,
  ].join("\n");
}

function compileImage2PromptSpec(spec: ImageStudioImage2PromptSpec, shotBrief: ImageStudioShotBrief) {
  return [
    "Create an ecommerce product image using the following image2 production specification.",
    "",
    "TASK",
    formatShotBriefList(spec.task),
    "",
    "REFERENCE IMAGES",
    formatImage2ReferenceImages(spec.referenceImages),
    "",
    "PRODUCT INVARIANTS",
    formatShotBriefList(spec.productInvariants),
    "",
    "IMAGE REQUIREMENTS",
    formatShotBriefList(spec.imageRequirements),
    "",
    "COMPOSITION",
    formatShotBriefList(spec.composition),
    "",
    "VISIBLE TEXT",
    formatVisibleTextSpec(spec.visibleText),
    "",
    "FORBIDDEN",
    formatShotBriefList(spec.forbidden),
    "",
    "RUNTIME",
    formatShotBriefList(spec.runtime),
  ].filter(Boolean).join("\n");
}

function compileShotBriefToGptImage2Prompt(shotBrief: ImageStudioShotBrief) {
  if (shotBrief.image2Spec) {
    return compileImage2PromptSpec(shotBrief.image2Spec, shotBrief);
  }

  const overlayPlan = shotBrief.overlayPlan
    ? compactShotList([
        shotBrief.overlayPlan.placement ? `Placement: ${shotBrief.overlayPlan.placement}.` : "",
        shotBrief.overlayPlan.allowedText?.length ? `Allowed image2-rendered text: ${shotBrief.overlayPlan.allowedText.join(", ")}.` : "",
        shotBrief.overlayPlan.notes?.length ? `Overlay notes: ${shotBrief.overlayPlan.notes.join(" ")}` : "",
      ]).join(" ")
    : "No overlay plan.";

  return [
    "GPT-Image-2 structured e-commerce image prompt generated from ShotBrief.",
    `ShotBrief version: ${shotBrief.version}.`,
    `Image type: ${shotBrief.imageType}.`,
    shotBrief.categoryStrategy ? `Category visual strategy: ${shotBrief.categoryStrategy}.` : "",
    shotBrief.proofType ? `Proof type: ${shotBrief.proofType}.` : "",
    shotBrief.storyIntent ? `Story intent: ${shotBrief.storyIntent}` : "",
    shotBrief.shopperQuestion ? `Shopper question this image must answer visually: ${shotBrief.shopperQuestion}` : "",
    shotBrief.conversionRole ? `Conversion role: ${shotBrief.conversionRole}.` : "",
    shotBrief.mainImageStrategy ? `MainImageStrategy:\n${formatMainImageStrategy(shotBrief.mainImageStrategy)}` : "",
    `Product identity: ${shotBrief.productIdentity}`,
    `Product facts to preserve: ${formatShotBriefList(shotBrief.productFacts)}`,
    `Image purpose: ${shotBrief.purpose}`,
    `Scene script: ${shotBrief.scene}`,
    shotBrief.humanAction ? `Human action: ${shotBrief.humanAction}` : "",
    shotBrief.mirrorReflection ? `Mirror/reflection requirement: ${shotBrief.mirrorReflection}` : "",
    `Composition: ${shotBrief.composition}`,
    `Camera: ${shotBrief.camera}`,
    `Lighting: ${shotBrief.lighting}`,
    `Style: ${shotBrief.style}`,
    `Required visual elements: ${formatShotBriefList(shotBrief.requiredElements)}`,
    `Text policy: ${shotBrief.textPolicy}`,
    `Image2 text/callout plan: ${overlayPlan}`,
    `Forbidden elements: ${formatShotBriefList(shotBrief.forbiddenElements)}`,
    shotBrief.operatorNotes?.length ? `Operator notes: ${formatShotBriefList(shotBrief.operatorNotes)}` : "",
  ].filter(Boolean).join("\n");
}

function buildShotBriefPlan(
  plan: ImageStudioPlan,
  analysis: ImageStudioAnalysis,
  context: ShotBriefBuildContext,
): ImageStudioPlan {
  const shotBrief = buildShotBriefFromPlan(plan, analysis, context);
  const prompt = compileShotBriefToGptImage2Prompt(shotBrief);

  return {
    ...plan,
    shotBrief,
    prompt,
    compiledPrompt: prompt,
    promptSource: SHOT_BRIEF_PROMPT_SOURCE,
    layout: undefined,
    lang: undefined,
  };
}

function buildShotBriefPlans(
  plans: ImageStudioPlan[],
  analysis: ImageStudioAnalysis,
  context: ShotBriefBuildContext,
) {
  return plans.map((plan) => buildShotBriefPlan(plan, analysis, context));
}

// Keep the ShotBrief compiler available for prompt diagnostics, but the active GPT image
// generation path below uses the legacy AI 出图 prompt directly.
void buildShotBriefPlans;

const LEGACY_IMAGE2_ADAPTER_MARKER = "IMAGE2 ECOMMERCE ADAPTER V2";
const LEGACY_IMAGE2_ADAPTER_ANY_MARKER = "IMAGE2 ECOMMERCE ADAPTER";

type LegacyImage2PlanContext = {
  packCount?: number;
  productMode?: ImageStudioProductMode;
  referenceImages?: ImageStudioReferenceImage[];
  salesRegion?: string;
  imageLanguage?: string;
  imageSize?: string;
  productName?: string;
  analysis?: ImageStudioAnalysis;
  selectedImageTypes?: string[];
  planIndex?: number;
  planCount?: number;
};

function normalizeLegacyImage2PlanContext(context: number | LegacyImage2PlanContext = {}): LegacyImage2PlanContext {
  return typeof context === "number" ? { packCount: context } : context;
}

function isPhoneRelevantProduct(context: LegacyImage2PlanContext) {
  const analysis = context.analysis;
  const text = [
    context.productName,
    analysis?.productName,
    analysis?.category,
    analysis?.productFacts?.productName,
    analysis?.productFacts?.category,
    analysis?.productFacts?.mountingPlacement,
    analysis?.creativeDirection?.pageGoal,
    analysis?.creativeDirection?.visualStyle,
    ...(analysis?.sellingPoints || []),
    ...(analysis?.usageScenes || []),
    ...(analysis?.operatorInsights?.usageActions || []),
    ...(analysis?.operatorInsights?.proofPoints || []),
  ].filter(Boolean).join(" ").toLowerCase();

  const hasPhoneOrDeviceSubject = /\b(phone|smartphone|iphone|android|mobile phone|cellphone|tablet|laptop)\b|手机|智能手机|平板|笔记本电脑/.test(text);
  const hasSpecificPhoneAccessory = /\b(phone|smartphone|iphone|android|mobile|cellphone|tablet)\s*(case|cover|charger|charging|cable|adapter|stand|holder|mount|dock|screen protector)\b|\b(magsafe|power bank|screen protector|earbud|headphone|keyboard|mouse)\b|手机壳|手机套|手机支架|手机夹|车载支架|手机充电|充电器|数据线|转接头|钢化膜|保护膜|充电宝|移动电源|耳机|键盘|鼠标/.test(text);
  const hasCompatibilityWording = /\b(fit|compatible|connect|pair|charge|charging|dock|mount)\s+(phone|smartphone|iphone|android|tablet|laptop)\b|\b(phone|smartphone|iphone|android|tablet|laptop)\s+(fit|compatible|connect|pair|charge|charging|dock|mount)\b|适配手机|手机适配|连接手机|给手机充电|手机固定/.test(text);

  return hasPhoneOrDeviceSubject || hasSpecificPhoneAccessory || hasCompatibilityWording;
}

function unwrapLegacyImage2AdapterPrompt(prompt: string) {
  const normalized = prompt.trim();
  if (!normalized.includes(LEGACY_IMAGE2_ADAPTER_ANY_MARKER)) return normalized;

  const sourceSection = normalized.split("\nLEGACY AI IMAGE PROMPT\n")[1];
  if (!sourceSection) return normalized;

  return sourceSection.split("\n\nIMAGE2 FINAL RULES")[0]?.trim() || normalized;
}

function stripLegacyImage2Section(prompt: string, marker: string) {
  const lines = prompt.split(/\r?\n/);
  const output: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmedLine = line.trim();
    const startsSection = line.includes(marker);
    const knownLegacySectionHeader = /(?:COMMERCIAL ANALYSIS|COMPOSITION|BLANK ZONES|NO TEXT IN IMAGE|REGIONAL STYLE|FRAMING|PRODUCT IDENTITY|SINGLE PRODUCT COUNT LOCK|REAL-WORLD SCALE LOCK|IMAGE2 FINAL RULES)\b/.test(trimmedLine);
    const startsNextSection = skipping
      && !trimmedLine.startsWith("-")
      && (
        knownLegacySectionHeader
        ||
        (/^[^\n]{3,100}[:：]\s*$/.test(trimmedLine) && /[A-Z]{3,}/.test(trimmedLine))
        || (/^[A-Z0-9 +/()_-]{4,80}$/.test(trimmedLine) && /[A-Z]{3,}/.test(trimmedLine))
      );

    if (startsSection) {
      skipping = true;
      continue;
    }
    if (skipping && startsNextSection) {
      skipping = false;
    }
    if (!skipping) {
      output.push(line);
    }
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeLegacyImage2BasePrompt(prompt: string, imageType: string) {
  let sanitized = prompt.trim();
  sanitized = stripLegacyImage2Section(sanitized, "COMMERCIAL ANALYSIS");
  sanitized = stripLegacyImage2Section(sanitized, "BLANK ZONES");
  sanitized = stripLegacyImage2Section(sanitized, "NO TEXT IN IMAGE");
  sanitized = stripLegacyImage2Section(sanitized, "REGIONAL STYLE");
  sanitized = stripLegacyImage2Section(sanitized, "FRAMING");
  sanitized = stripLegacyImage2Section(sanitized, "REAL-WORLD SCALE LOCK");
  sanitized = stripLegacyImage2Section(sanitized, "SINGLE PRODUCT COUNT LOCK");

  if (imageType === "main") {
    sanitized = sanitized
      .replace(/\bclean\s+light\s+gray\s+background\b/gi, "pure white background")
      .replace(/\blight\s+gray\s+backgrounds?\b/gi, "pure white background")
      .replace(/\bmuted\s+tones?\b/gi, "neutral product tones")
      .trim();
  }

  if (imageType === "dimensions") {
    sanitized = sanitized
      .replace(/use\s+(?:a\s+)?(?:phone|smartphone|coin|hand|pen|ruler|car|wheel|everyday object)[^.。；;\n]*(?:[.。；;]|$)/gi, "")
      .replace(/(?:phone|smartphone|tablet|laptop|coin|pen|ruler|hand|car|wheel|black rectangle)\s+(?:scale|reference|cue|comparison)[^.。；;\n]*(?:[.。；;]|$)/gi, "")
      .replace(/(?:手机|智能手机|平板|电脑|硬币|笔|尺子|手|汽车|车轮|黑色矩形)[^。；;\n]*(?:参照|参考|对比|比例)[^。；;\n]*(?:[。；;]|$)/g, "")
      .trim();
  }

  return sanitized;
}

const LEGACY_IMAGE2_INSIGHT_KEYWORDS = {
  size: ["size", "scale", "compact", "small", "large", "larger", "hand", "palm", "store", "storage", "portable", "capacity", "尺寸", "掌心", "便携", "收纳", "体积", "容量", "大罐", "小尺寸"],
  texture: ["cream", "paste", "texture", "liquid", "spray", "formula", "lid", "open", "material", "膏", "膏体", "质地", "喷雾", "液体", "打开"],
  use: ["use", "method", "apply", "applying", "wipe", "wiping", "buff", "treatment", "surface", "spot", "使用", "涂抹", "擦拭", "抛光", "局部"],
  packaging: ["package", "packaging", "box", "gift", "accessor", "contents", "retail", "包装", "礼盒", "配件", "外盒", "附赠"],
  scratch: ["scratch", "deep", "damage", "repair", "paint", "loss", "before", "after", "划痕", "深层", "掉漆", "钣金", "损伤", "修复"],
};

function selectInsightItems(items: string[], keywords: string[], maxItems: number, fallbackStart: number | null = 0) {
  const matched = items.filter((item) => {
    const text = item.toLowerCase();
    return keywords.some((keyword) => text.includes(keyword));
  });
  const fallback = fallbackStart === null ? [] : items.slice(fallbackStart);
  return dedupeTextList([...matched, ...fallback]).slice(0, maxItems);
}

type LegacyImage2FeatureTheme = "size" | "texture" | "use" | "scratch";

type LegacyImage2InsightAllocation = {
  theme?: LegacyImage2FeatureTheme;
  purchaseDrivers: string[];
  usageActions: string[];
  proofPoints: string[];
  buyerQuestions: string[];
  riskFlags: string[];
};

function scoreInsightTheme(text: string, theme: LegacyImage2FeatureTheme) {
  const keywords = theme === "scratch"
    ? LEGACY_IMAGE2_INSIGHT_KEYWORDS.scratch
    : LEGACY_IMAGE2_INSIGHT_KEYWORDS[theme];
  return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

function inferLegacyImage2FeatureTheme(context: LegacyImage2PlanContext): LegacyImage2FeatureTheme {
  const insights = context.analysis?.operatorInsights;
  const weightedText = [
    compactShotList([insights?.purchaseDrivers]).join(" "),
    compactShotList([insights?.proofPoints]).join(" "),
    compactShotList([insights?.buyerQuestions]).join(" "),
    compactShotList([context.analysis?.sellingPoints, insights?.sellingPoints]).join(" "),
  ].join(" ").toLowerCase();

  const scores: Array<[LegacyImage2FeatureTheme, number]> = [
    ["size", scoreInsightTheme(weightedText, "size")],
    ["texture", scoreInsightTheme(weightedText, "texture")],
    ["use", scoreInsightTheme(weightedText, "use")],
    ["scratch", scoreInsightTheme(weightedText, "scratch")],
  ];

  scores.sort((a, b) => b[1] - a[1]);
  return scores[0]?.[1] ? scores[0][0] : "use";
}

function getLegacyImage2ThemeKeywords(theme: LegacyImage2FeatureTheme) {
  if (theme === "scratch") {
    return [...LEGACY_IMAGE2_INSIGHT_KEYWORDS.scratch, ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.use];
  }
  return LEGACY_IMAGE2_INSIGHT_KEYWORDS[theme];
}

function getImageTypeStoryStep(imageType: string) {
  const steps: Record<string, string> = {
    main: "IDENTITY + CLICK REASON: make the SKU instantly clear and give one strong reason to click.",
    features: "SELLING POINT: explain the strongest buyer benefit with 2-3 related signals.",
    closeup: "MATERIAL / QUALITY: prove real texture, finish, formula, construction, edge, or working detail.",
    dimensions: "SIZE: prove true dimensions using only the product and measurement graphics, with no reference objects.",
    lifestyle: "USE: show the most realistic use action with visible product interaction.",
    packaging: "PACKAGE / CONTENTS: clarify what the customer receives without inventing packaging.",
    comparison: "COMPARISON: show a fair contrast that helps the buyer decide without exaggerated claims.",
    lifestyle2: "TRUST / A+ CLOSE: close the set with believable trust, desirability, and product confidence.",
    scene_a: "USE DETAIL: answer one practical buyer question through a distinct action or context.",
    scene_b: "BUYER DOUBT / TRUST: answer a different doubt or trust point without repeating scene A.",
  };
  return steps[imageType] || "Use only the part of the story relevant to this image type.";
}

function buildLegacyImage2InsightAllocation(imageType: string, context: LegacyImage2PlanContext): LegacyImage2InsightAllocation {
  const insights = context.analysis?.operatorInsights;
  const purchaseDrivers = compactShotList([insights?.purchaseDrivers]);
  const usageActions = compactShotList([insights?.usageActions]);
  const proofPoints = compactShotList([insights?.proofPoints]);
  const buyerQuestions = compactShotList([insights?.buyerQuestions]);
  const riskFlags = compactShotList([insights?.riskFlags]);

  if (imageType === "main") {
    return {
      purchaseDrivers: selectInsightItems(
        purchaseDrivers,
        [
          ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.use,
          ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.texture,
          ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.size,
          ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.packaging,
        ],
        1,
      ),
      usageActions: [],
      proofPoints: selectInsightItems(
        proofPoints,
        [
          ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.texture,
          ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.use,
          ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.size,
        ],
        1,
      ),
      buyerQuestions: selectInsightItems(buyerQuestions, [...LEGACY_IMAGE2_INSIGHT_KEYWORDS.use, ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.size], 1),
      riskFlags: selectInsightItems(riskFlags, [...LEGACY_IMAGE2_INSIGHT_KEYWORDS.size, ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.packaging], 2),
    };
  }

  if (imageType === "closeup") {
    return {
      purchaseDrivers: selectInsightItems(purchaseDrivers, LEGACY_IMAGE2_INSIGHT_KEYWORDS.texture, 1),
      usageActions: selectInsightItems(usageActions, ["open", "lid", "cream", "paste"], 1),
      proofPoints: selectInsightItems(proofPoints, LEGACY_IMAGE2_INSIGHT_KEYWORDS.texture, 2),
      buyerQuestions: selectInsightItems(buyerQuestions, ["tool", "apply", "direct", "cream", "spray", "liquid"], 1),
      riskFlags: selectInsightItems(riskFlags, ["spray", "liquid", "claim", "deep", "damage"], 2),
    };
  }

  if (imageType === "dimensions") {
    return {
      purchaseDrivers: selectInsightItems(purchaseDrivers, LEGACY_IMAGE2_INSIGHT_KEYWORDS.size, 1),
      usageActions: [],
      proofPoints: selectInsightItems(proofPoints, LEGACY_IMAGE2_INSIGHT_KEYWORDS.size, 2),
      buyerQuestions: selectInsightItems(buyerQuestions, LEGACY_IMAGE2_INSIGHT_KEYWORDS.size, 2),
      riskFlags: selectInsightItems(riskFlags, LEGACY_IMAGE2_INSIGHT_KEYWORDS.size, 2),
    };
  }

  if (imageType === "packaging") {
    return {
      purchaseDrivers: selectInsightItems(purchaseDrivers, ["store", "portable", "gift", "package"], 1),
      usageActions: [],
      proofPoints: selectInsightItems(proofPoints, ["store", "storage", "package", "portable"], 1),
      buyerQuestions: selectInsightItems(buyerQuestions, ["package", "packaging", "store", "storage", "gift"], 1),
      riskFlags: selectInsightItems(riskFlags, LEGACY_IMAGE2_INSIGHT_KEYWORDS.packaging, 3),
    };
  }

  if (imageType === "comparison") {
    return {
      purchaseDrivers: selectInsightItems(purchaseDrivers, [...LEGACY_IMAGE2_INSIGHT_KEYWORDS.scratch, ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.use], 1),
      usageActions: selectInsightItems(usageActions, ["apply", "wipe", "buff", "surface", "scratch"], 1),
      proofPoints: selectInsightItems(proofPoints, [...LEGACY_IMAGE2_INSIGHT_KEYWORDS.use, ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.scratch], 1),
      buyerQuestions: selectInsightItems(buyerQuestions, LEGACY_IMAGE2_INSIGHT_KEYWORDS.scratch, 2),
      riskFlags: selectInsightItems(riskFlags, LEGACY_IMAGE2_INSIGHT_KEYWORDS.scratch, 2),
    };
  }

  if (imageType === "lifestyle") {
    const useKeywords = LEGACY_IMAGE2_INSIGHT_KEYWORDS.use;
    return {
      purchaseDrivers: selectInsightItems(purchaseDrivers, useKeywords, 1),
      usageActions: selectInsightItems(usageActions, useKeywords, 1),
      proofPoints: selectInsightItems(proofPoints, useKeywords, 1),
      buyerQuestions: selectInsightItems(buyerQuestions, useKeywords, 1),
      riskFlags: selectInsightItems(riskFlags, [...LEGACY_IMAGE2_INSIGHT_KEYWORDS.size, ...LEGACY_IMAGE2_INSIGHT_KEYWORDS.scratch], 2),
    };
  }

  if (imageType === "lifestyle2") {
    return {
      purchaseDrivers: purchaseDrivers.slice(-1),
      usageActions: usageActions.slice(-1),
      proofPoints: proofPoints.slice(-1),
      buyerQuestions: buyerQuestions.slice(-1),
      riskFlags: riskFlags.slice(-2),
    };
  }

  if (imageType === "scene_a") {
    return {
      purchaseDrivers: purchaseDrivers.slice(0, 1),
      usageActions: usageActions.slice(0, 1),
      proofPoints: proofPoints.slice(0, 1),
      buyerQuestions: buyerQuestions.slice(0, 1),
      riskFlags: riskFlags.slice(0, 2),
    };
  }

  if (imageType === "scene_b") {
    return {
      purchaseDrivers: purchaseDrivers.slice(1, 2),
      usageActions: usageActions.slice(1, 2).length ? usageActions.slice(1, 2) : usageActions.slice(-1),
      proofPoints: proofPoints.slice(1, 2).length ? proofPoints.slice(1, 2) : proofPoints.slice(-1),
      buyerQuestions: buyerQuestions.slice(1, 2).length ? buyerQuestions.slice(1, 2) : buyerQuestions.slice(-1),
      riskFlags: riskFlags.slice(1, 3),
    };
  }

  if (imageType === "features") {
    const featureTheme = inferLegacyImage2FeatureTheme(context);
    const themeKeywords = getLegacyImage2ThemeKeywords(featureTheme);
    const selectedPurchaseDrivers = selectInsightItems(purchaseDrivers, themeKeywords, 1, null);
    const selectedProofPoints = selectInsightItems(proofPoints, themeKeywords, 1, null);
    const selectedBuyerQuestions = selectInsightItems(buyerQuestions, themeKeywords, 1, null);
    const selectedRiskFlags = selectInsightItems(riskFlags, themeKeywords, 2, null);

    return {
      theme: featureTheme,
      purchaseDrivers: selectedPurchaseDrivers.length ? selectedPurchaseDrivers : purchaseDrivers.slice(0, 1),
      usageActions: selectInsightItems(usageActions, themeKeywords, 1, null),
      proofPoints: selectedProofPoints.length ? selectedProofPoints : proofPoints.slice(0, 1),
      buyerQuestions: selectedBuyerQuestions,
      riskFlags: selectedRiskFlags.length ? selectedRiskFlags : riskFlags.slice(0, 1),
    };
  }

  return {
    purchaseDrivers: purchaseDrivers.slice(0, 2),
    usageActions: usageActions.slice(0, 2),
    proofPoints: proofPoints.slice(0, 2),
    buyerQuestions: buyerQuestions.slice(0, 2),
    riskFlags: riskFlags.slice(0, 2),
  };
}

function buildLegacyImage2ProductFacts(context: LegacyImage2PlanContext) {
  const analysis = context.analysis;
  const phonePolicy = isPhoneRelevantProduct(context)
    ? "Phone/device props are allowed only when they are part of the real product use case or compatibility proof."
    : "Do not add a phone, smartphone, tablet, laptop, or electronic device as a scale prop, background prop, hand prop, or decorative object.";
  if (!analysis) {
    return compactShotList([
      context.productName ? `Product name: ${context.productName}` : "",
      "Use visible information from the uploaded references as the highest-priority product facts.",
      phonePolicy,
    ]);
  }

  return compactShotList([
    context.productName || analysis.productName || analysis.productFacts?.productName
      ? `Product name: ${context.productName || analysis.productName || analysis.productFacts?.productName}`
      : "",
    analysis.category || analysis.productFacts?.category ? `Category: ${analysis.category || analysis.productFacts?.category}` : "",
    analysis.materials || analysis.productFacts?.materials ? `Materials: ${analysis.materials || analysis.productFacts?.materials}` : "",
    analysis.colors || analysis.productFacts?.colors ? `Colors: ${analysis.colors || analysis.productFacts?.colors}` : "",
    analysis.estimatedDimensions || analysis.productFacts?.estimatedDimensions
      ? `Verified or estimated dimensions: ${analysis.estimatedDimensions || analysis.productFacts?.estimatedDimensions}`
      : "",
    analysis.productFacts?.productForm ? `Product form: ${analysis.productFacts.productForm}` : "",
    analysis.productFacts?.countAndConfiguration ? `Count/configuration: ${analysis.productFacts.countAndConfiguration}` : "",
    analysis.productFacts?.mountingPlacement ? `Mounting/placement: ${analysis.productFacts.mountingPlacement}` : "",
    analysis.productFacts?.packagingEvidence ? `Packaging evidence: ${analysis.productFacts.packagingEvidence}` : "",
    analysis.productFacts?.factGuardrails || [],
    phonePolicy,
  ]);
}

function formatLegacyImage2AssignedList(label: string, items: string[]) {
  return items.length ? `${label}: ${items.join("; ")}` : "";
}

function buildLegacyImage2PlanAllocationRules(context: LegacyImage2PlanContext, imageType: string) {
  const allocation = buildLegacyImage2InsightAllocation(imageType, context);
  const featureTheme = allocation.theme ? `Assigned feature theme: ${allocation.theme}.` : "";
  const planPosition = typeof context.planIndex === "number" && context.planCount
    ? `Gallery slot: ${context.planIndex + 1} of ${context.planCount}.`
    : "";
  const selectedTypes = context.selectedImageTypes?.length
    ? `Selected gallery types in this run: ${context.selectedImageTypes.join(", ")}.`
    : "";

  return compactShotList([
    "Use only this image type's assigned slice of the analysis. Do not import unrelated analysis items from the legacy prompt when they conflict with this image role.",
    planPosition,
    selectedTypes,
    `Story step: ${getImageTypeStoryStep(imageType)}`,
    featureTheme,
    formatLegacyImage2AssignedList("Assigned purchase driver", allocation.purchaseDrivers),
    formatLegacyImage2AssignedList("Assigned visible action", allocation.usageActions),
    formatLegacyImage2AssignedList("Assigned proof point", allocation.proofPoints),
    formatLegacyImage2AssignedList("Assigned buyer question", allocation.buyerQuestions),
    formatLegacyImage2AssignedList("Assigned risk to avoid", allocation.riskFlags),
    imageType === "main"
      ? "Main should use one high-value slice of the analysis only: exact SKU identity plus one strongest purchase driver, proof point, or buyer question. Do not import the full A+ story."
      : "",
    imageType === "features"
      ? "Features should cover one conversion cluster with 2-3 supporting signals, not a poster with every selling point."
      : "",
    imageType === "scene_b"
      ? "Scene B must not repeat Scene A; choose a distinct action, setting, buyer question, or proof point."
      : "",
  ]);
}

function buildLegacyImage2PremiumVisualRules(imageType: string) {
  const shared = [
    "Premium standard: create a polished cross-border ecommerce visual that feels like a high-quality product photography or A+ detail module, not a bargain poster.",
    "Use visual restraint: refined lighting, believable material rendering, clean negative space, controlled contrast, and a simple palette derived from the product and real use context.",
    "Avoid cheap marketplace styling: no sticker-like badges, clipart icons, thick arrows, noisy gradients, neon glow, busy color blocks, thick colored header bars, harsh blue ribbons, fake UI panels, red-X/green-check gimmicks, crowded feature walls, fake 3D labels, low-end collage, or decorative filler props.",
    "Do not add generic lifestyle props for scale. A scale cue must come from the product's real use context, not from a random phone, coin, ruler, pen, or gadget.",
    "Product fidelity still wins over beauty. Do not redesign the product, invent packaging, exaggerate scale, or hide flaws by over-stylizing.",
  ];

  const typeRules: Record<string, string[]> = {
    main: [
      "Main image premium feel comes from a high-end conversion hero layout: crisp product identity, one useful visual proof, refined lighting, generous negative space, and very restrained typography.",
      "Avoid the plain document-photo look when the product needs explanation. Use a polished ecommerce hero composition rather than a cheap poster, collage, or crowded infographic.",
    ],
    features: [
      "Feature image should feel like a premium A+ hero module: one conversion theme, one clear focal point, and 2-3 well-spaced information signals when they improve understanding.",
      "If text is used, make it editorial and readable: one headline plus up to two short callouts, generous spacing, no tiny captions, no icon grid.",
    ],
    closeup: [
      "Close-up should look like macro commercial photography: texture, fibers, finish, formula, seams, or construction rendered with depth and tactile realism.",
      "Avoid generic 'detail view' poster styling; let the material proof carry the premium feel.",
    ],
    dimensions: [
      "Dimension image should be precise and calm: thin guide lines, aligned labels, plenty of whitespace, and no crowded ruler-board look.",
      "Do not turn size proof into a cheap infographic; keep the product elegant and technically clear.",
      "Do not use phones, tablets, coins, pens, ruler objects, hands, cars, wheels, packaging boxes, or unrelated gadgets as size props. The only subject should be the product.",
    ],
    lifestyle: [
      "Lifestyle should feel like believable editorial product use: natural hand posture, real contact with the product, authentic environment, and clean composition.",
      "Avoid stock-photo clutter, staged smiles, messy backgrounds, luxury props unrelated to the product, or tiny product placement.",
    ],
    packaging: [
      "Packaging/contents image should feel like a restrained unboxing or clean contents layout, not a gift-box fantasy.",
      "Use neutral packaging only when evidence is weak; premium means truthful, orderly, and uncluttered.",
    ],
    comparison: [
      "Comparison image should be honest and premium: clean split or paired composition, consistent lighting, restrained labels, no miracle transformation.",
      "Avoid aggressive before/after advertising, fake percentages, red warning marks, or exaggerated dirty-vs-perfect drama.",
    ],
    lifestyle2: [
      "A+ closing image should feel like a polished detail-page banner: aspirational but believable, product-first, refined lighting, and strong negative space.",
      "Do not make it look like a discount ad; remove loud claims and let the scene communicate trust.",
    ],
    scene_a: [
      "Scene A should be a premium practical proof scene: one buyer question, one natural action, product clearly visible, no clutter.",
    ],
    scene_b: [
      "Scene B should be a second premium practical proof scene with a clearly different action, angle, or setting from Scene A.",
    ],
  };

  return compactShotList([shared, typeRules[imageType] || []]);
}

function buildLegacyImage2BuyerIntentRules(context: LegacyImage2PlanContext, imageType: string) {
  const analysis = context.analysis;
  const allocation = buildLegacyImage2InsightAllocation(imageType, context);
  if (imageType === "main") {
    return compactShotList([
      "Main image buyer intent: make the exact SKU instantly identifiable while giving one clear reason to click or buy.",
      analysis?.creativeDirection?.visualStyle
        ? `Main image visual style: use the premium ecommerce version of this direction: ${analysis.creativeDirection.visualStyle}. Keep it refined, uncluttered, and product-first.`
        : "",
      allocation.purchaseDrivers.length ? `Main image primary conversion cue: ${allocation.purchaseDrivers[0]}` : "",
      allocation.proofPoints.length ? `Main image proof cue: ${allocation.proofPoints[0]}` : "",
      allocation.buyerQuestions.length ? `Main image should visually answer this one buyer doubt: ${allocation.buyerQuestions[0]}` : "",
      allocation.riskFlags.length ? `Main image risks to avoid: ${allocation.riskFlags.join("; ")}` : "",
    ]);
  }

  return compactShotList([
    analysis?.creativeDirection?.pageGoal ? `Page goal: ${analysis.creativeDirection.pageGoal}` : "",
    analysis?.creativeDirection?.visualStyle ? `Visual style direction: ${analysis.creativeDirection.visualStyle}` : "",
    `A+ story step for this image: ${getImageTypeStoryStep(imageType)}`,
    allocation.purchaseDrivers.length ? `Purchase drivers to prove visually in this image: ${allocation.purchaseDrivers.join("; ")}` : "",
    allocation.usageActions.length ? `Real use actions assigned to this image: ${allocation.usageActions.join("; ")}` : "",
    allocation.proofPoints.length ? `Proof points assigned to this image: ${allocation.proofPoints.join("; ")}` : "",
    allocation.buyerQuestions.length ? `Buyer questions this image should answer visually: ${allocation.buyerQuestions.join("; ")}` : "",
    allocation.riskFlags.length ? `Risks this image must avoid: ${allocation.riskFlags.join("; ")}` : "",
    analysis?.targetAudience?.length || analysis?.operatorInsights?.targetAudience?.length
      ? `Target shoppers: ${compactShotList([analysis.targetAudience, analysis.operatorInsights?.targetAudience]).join("; ")}`
      : "",
  ]);
}

function isLegacyImage2UseSceneType(imageType: string) {
  return imageType === "features"
    || imageType === "lifestyle"
    || imageType === "lifestyle2"
    || imageType === "scene_a"
    || imageType === "scene_b"
    || imageType === "comparison";
}

function buildFeatureThemeActionCue(theme: LegacyImage2FeatureTheme | undefined, context: LegacyImage2PlanContext) {
  const productText = [
    context.analysis?.estimatedDimensions,
    context.analysis?.productFacts?.estimatedDimensions,
    context.analysis?.productFacts?.mountingPlacement,
    context.analysis?.productFacts?.countAndConfiguration,
    context.analysis?.productFacts?.factGuardrails,
  ].flat().filter(Boolean).join(" ").toLowerCase();
  const looksHandheld = /palm|handheld|hand|compact|small|mini|掌心|手持|便携|小尺寸|小型/.test(productText);

  if (theme === "size") {
    return looksHandheld
      ? "Feature cluster cue: prove compact size/portability through the real hand holding or using the product, or through its actual storage/use environment. Do not add phones, coins, rulers, pens, gadgets, or unverified accessories as scale props."
      : "Feature cluster cue: prove true scale/proportion with a clean product-first composition or the real use object/context. Do not add random scale props such as phones, coins, rulers, pens, or gadgets.";
  }

  if (theme === "texture") {
    return "Feature cluster cue: prove material/form/texture with one clear close product action such as opening, revealing, pouring, folding, or showing the real surface, depending on the category.";
  }

  if (theme === "scratch") {
    return "Feature cluster cue: prove the appropriate problem scope honestly; show only light surface marks or category-appropriate minor use, and do not imply severe damage repair.";
  }

  if (theme === "use") {
    return "Feature cluster cue: prove one real use method with one clear buyer action and 1-2 supporting detail cues, not a full multi-step tutorial.";
  }

  return "";
}

function buildLegacyImage2UsageActionRules(plan: ImageStudioPlan, context: LegacyImage2PlanContext) {
  const imageType = plan.imageType;
  const analysis = context.analysis;
  const allocation = buildLegacyImage2InsightAllocation(imageType, context);
  const allocationTheme = (allocation as { theme?: LegacyImage2FeatureTheme }).theme;
  const usageScenes = compactShotList([analysis?.usageScenes, analysis?.operatorInsights?.usageScenes]).slice(0, imageType === "features" ? 2 : 3);
  const sellingPoints = compactShotList([analysis?.sellingPoints, analysis?.operatorInsights?.sellingPoints]).slice(0, imageType === "features" ? 2 : 3);
  const assignedBenefits = compactShotList([allocation.purchaseDrivers, sellingPoints]).slice(0, imageType === "features" ? 2 : 3);
  const productFacts = analysis?.productFacts;

  if (imageType === "closeup") {
    return compactShotList([
      "Close-up should prove one material, formula, texture, construction, or form detail; it is not a full use scene.",
      allocation.usageActions.length ? `Detail action cue for this image only: ${allocation.usageActions.join("; ")}` : "",
      allocation.proofPoints.length ? `Detail proof assigned to this image: ${allocation.proofPoints.join("; ")}` : "",
      allocation.buyerQuestions.length ? `Buyer question this close-up should answer visually: ${allocation.buyerQuestions.join("; ")}` : "",
      allocation.riskFlags.length ? `Detail risks to avoid: ${allocation.riskFlags.join("; ")}` : "",
      productFacts?.mountingPlacement ? `Respect product handling/use facts without turning this into a lifestyle scene: ${productFacts.mountingPlacement}` : "",
      "Keep enough of the product visible that the close-up still belongs to the same SKU.",
    ]);
  }

  if (imageType === "dimensions") {
    return compactShotList([
      "Dimension image should prove true size and proportion; do not use it to show the full A+ story.",
      productFacts?.countAndConfiguration ? `Count/configuration truth: ${productFacts.countAndConfiguration}` : "",
      allocation.proofPoints.length ? `Size proof assigned to this image: ${allocation.proofPoints.join("; ")}` : "",
      allocation.buyerQuestions.length ? `Buyer size question to answer visually: ${allocation.buyerQuestions.join("; ")}` : "",
      allocation.riskFlags.length ? `Size risks to avoid: ${allocation.riskFlags.join("; ")}` : "",
      "Use exact measurements only when verified; otherwise show non-numeric scale/proportion without inventing numbers.",
      "Use only the product itself plus thin measurement guide lines and exact measurement labels. Do not include any reference object.",
      "Forbidden in dimension image: phone, smartphone, tablet, laptop, black rectangle, hand, person, coin, pen, ruler object, measuring card, car, wheel, table prop, cosmetic bottle, packaging box, or any everyday object used for scale.",
    ]);
  }

  if (imageType === "packaging") {
    return compactShotList([
      "Packaging/contents image must follow packaging evidence, not imagined gift-box styling.",
      productFacts?.packagingEvidence ? `Packaging evidence to obey: ${productFacts.packagingEvidence}` : "If no real packaging evidence exists, show product contents or neutral unbranded packaging only.",
      productFacts?.countAndConfiguration ? `Count/configuration truth: ${productFacts.countAndConfiguration}` : "",
      allocation.proofPoints.length ? `Packaging/storage proof assigned to this image: ${allocation.proofPoints.join("; ")}` : "",
      allocation.buyerQuestions.length ? `Packaging question to answer visually: ${allocation.buyerQuestions.join("; ")}` : "",
      allocation.riskFlags.length ? `Packaging risks to avoid: ${allocation.riskFlags.join("; ")}` : "",
      "Do not add manuals, tools, inserts, certifications, outer boxes, accessories, or luxury packaging unless verified.",
    ]);
  }

  if (!isLegacyImage2UseSceneType(imageType)) {
    return compactShotList([
      "Do not force a human or use scene into this image type unless the legacy prompt explicitly asks for it.",
      productFacts?.mountingPlacement ? `Respect mounting/placement facts even in non-scene images: ${productFacts.mountingPlacement}` : "",
      allocation.riskFlags.length ? `Risks to avoid for this image: ${allocation.riskFlags.join("; ")}` : "",
    ]);
  }

  return compactShotList([
    "This image type must show a clear real-world reason to buy, not just a static product placement.",
    "Use the product as the action subject: show it being applied, opened, installed, worn, held, placed, cleaned, repaired, organized, displayed, or otherwise used according to the category.",
    imageType === "features" ? buildFeatureThemeActionCue(allocationTheme, context) : "",
    usageScenes.length ? `Preferred usage contexts from analysis: ${usageScenes.join("; ")}` : "Infer a realistic everyday usage context from the product category and reference images.",
    allocation.usageActions.length ? `Assigned visible usage action for this image: ${allocation.usageActions.join("; ")}` : "",
    assignedBenefits.length ? `Assigned benefit to prove visually in this image: ${assignedBenefits.join("; ")}` : "",
    allocation.proofPoints.length ? `Assigned proof point for this image: ${allocation.proofPoints.join("; ")}` : "",
    allocation.buyerQuestions.length ? `Buyer question this image should answer visually: ${allocation.buyerQuestions.join("; ")}` : "",
    allocation.riskFlags.length ? `Risks this image must avoid: ${allocation.riskFlags.join("; ")}` : "",
    productFacts?.mountingPlacement ? `Usage/mounting must respect: ${productFacts.mountingPlacement}` : "",
    imageType === "features"
      ? "For feature images, pick one benefit/action/proof cluster and show 2-3 related signals inside that cluster; do not mix unrelated selling points into one poster."
      : "",
    imageType === "comparison"
      ? "For comparison images, make the contrast visible through scene, result, surface condition, fit, scale, or product state, not through dense text or exaggerated claims."
      : "",
    imageType === "lifestyle" || imageType === "lifestyle2" || imageType === "scene_a" || imageType === "scene_b"
      ? "Include natural human interaction when it helps: hand applying, holding, installing, wearing, placing, opening, cleaning, repairing, using, or viewing the product. The action must match the category."
      : "",
    imageType === "lifestyle"
      ? "Lifestyle should feel like a real buyer moment: the product solves a task in a believable home, car, beauty, office, outdoor, pet, kitchen, bathroom, decor, or tool-use context depending on category."
      : "",
    imageType === "lifestyle2"
      ? "A+ closing should combine product desirability with trust: polished but believable scene, product large enough to inspect, and clean negative space for a short value message if allowed."
      : "",
    imageType === "scene_a"
      ? "Scene A should answer the first practical question a buyer has: what it is, where it is used, how big it feels, or what problem it solves."
      : "",
    imageType === "scene_b"
      ? "Scene B must use a meaningfully different usage context, action, angle, environment, or buyer question from scene A."
      : "",
    "If a person appears, specify natural scale, visible contact with the product, believable hand/body pose, and gaze or attention directed at the task.",
    "The product must remain clearly visible during the action; do not hide it behind hands, props, reflections, smoke, blur, or text.",
  ]);
}

function buildLegacyImage2CompositionRules(imageType: string) {
  const shared = [
    "Follow a clear order: scene/background, subject/product, key details, then constraints.",
    "Specify one primary camera view and keep composition uncluttered.",
    "Use realistic commercial lighting with natural shadows; avoid surreal glow, excessive lens effects, and over-processed studio polish.",
    "Make product edges, material, and functional areas crisp enough for ecommerce inspection.",
  ];

  const typeRules: Record<string, string[]> = {
    main: [
      "Camera: straight-on or mild three-quarter product hero view.",
      "Framing: keep the product inside the square-safe center area, use high thumbnail fill only as packshot framing, preserve true compact/large proportions, and never crop product edges.",
      "Use a front, front-three-quarter, or top-down packshot angle that best explains the sellable unit; avoid dramatic low angles, lifestyle camera language, or editorial perspective.",
      "Background: pure white #FFFFFF / RGB 255,255,255.",
      "Lighting: clean catalog lighting with a small natural grounding shadow only; no tabletop, reflection plate, color wash, or decorative studio set.",
    ],
    features: [
      "Camera: product-first commercial composition that proves one feature through use, result, material, or function.",
      "Framing: keep one clear visual focus with product large enough to inspect and leave simple space for exact short callouts if allowed.",
      "Background: clean studio, light lifestyle, or simple split layout depending on the benefit; avoid busy poster design.",
    ],
    closeup: [
      "Camera: macro or tight close-up on the real material/detail area.",
      "Framing: one detail dominates the frame while enough surrounding product remains visible to understand what it is.",
      "Lighting: reveal texture, edge quality, connector shape, finish, formula, weave, grain, transparency, or construction without glamorizing into a different material.",
    ],
    dimensions: [
      "Camera: flat front, top-down, or orthographic-like view that makes size relationships clear.",
      "Framing: leave clean space for exact measurement lines only when exact measurements are available.",
      "Use a simple light background and a stable product pose; the size image should explain scale, not become a lifestyle scene.",
    ],
    packaging: [
      "Camera: clean three-quarter or top-down package-content layout.",
      "Framing: delivered contents are separated enough to count and recognize.",
      "Use a neutral unboxing or contents layout; avoid luxury gift staging unless real packaging evidence supports it.",
    ],
    comparison: [
      "Camera: split or side-by-side composition only if it stays visually simple.",
      "Framing: make the comparison understandable without relying on small text.",
      "Keep product scale and camera angle consistent between the compared sides so the result feels honest.",
    ],
    lifestyle: [
      "Camera: realistic eye-level, close-up, or over-the-shoulder usage shot.",
      "Framing: show the user's interaction with the product and enough environment to prove the use case.",
      "Keep the product large and unobstructed; the scene supports the product rather than becoming decor.",
    ],
    lifestyle2: [
      "Camera: polished final lifestyle or trust-building scene, still product-first.",
      "Framing: product remains the hero with a clear emotional or practical payoff.",
      "Use clean negative space and a premium detail-page feel without fake awards, badges, or excessive poster graphics.",
    ],
    scene_a: [
      "Camera: practical use/value proof shot with visible material, size, and function.",
      "Framing: use an environment that makes the product category and value immediately clear.",
      "Choose the most obvious buyer-use context for this product and show one clear action.",
    ],
    scene_b: [
      "Camera: second use/value proof shot with a distinct angle or situation from scene A.",
      "Framing: emphasize a different buyer question, use moment, or product proof.",
      "Avoid repeating the same scene composition as scene A; change the action, environment, distance, or proof point.",
    ],
  };

  return compactShotList([shared, typeRules[imageType] || []]);
}

function buildLegacyImage2IterationRules(plan: ImageStudioPlan, basePrompt: string) {
  return compactShotList([
    "Start from a clean, coherent single-image interpretation of the legacy prompt. Do not solve ambiguity by adding many text blocks, many panels, or random props.",
    "If the prompt contains many ideas, choose the one idea that best matches the current image type.",
    "If product identity conflicts with style, product identity wins.",
    "If exact product facts are missing, keep the visual generic and truthful instead of inventing labels, dimensions, packaging, certifications, or accessories.",
    "For redraw prompts, apply only the requested change while preserving product identity, image type, and useful composition.",
    basePrompt.length > 2600 ? "The legacy prompt is long; treat it as source material and prioritize the adapter's product, scene, text, and composition rules." : "",
  ]);
}

function isWeakIdentityReference(image: ImageStudioReferenceImage) {
  return /size|dimension|measurement|generated|screenshot|packaging|detail/i.test(`${image.role} ${image.label} ${image.instruction}`);
}

function buildReferenceReliabilityRules(context: LegacyImage2PlanContext) {
  const referenceImages = context.referenceImages || [];
  if (referenceImages.length === 0) return [];

  const weakIdentityCount = referenceImages.filter(isWeakIdentityReference).length;
  const allWeakIdentity = weakIdentityCount === referenceImages.length;

  return compactShotList([
    allWeakIdentity
      ? "Reference reliability warning: the uploaded references appear to be size guides, generated images, screenshots, packaging references, or detail-only images rather than clean real product identity photos."
      : "",
    allWeakIdentity
      ? "For the main image, do not copy hands, phones, coins, rulers, tables, decorative props, size-guide labels, or generated-layout artifacts from weak references."
      : "",
    allWeakIdentity
      ? "Do not invent exact packaging copy, brand marks, certifications, claims, or accessories from weak references. Keep labels blank/non-readable unless exact real packaging text is clearly provided."
      : "",
    "Treat real product identity photos as the highest priority when present. Treat size guides and generated images as fact/context references only.",
  ]);
}

function buildMainImageComplianceRules(context: LegacyImage2PlanContext, packCount: number) {
  return compactShotList([
    "MAIN IMAGE STANDARD: create a premium information-rich cross-border ecommerce first image, not a plain catalog ID photo and not a crowded poster.",
    "First-click goal: the shopper should understand what is being sold and why it is worth clicking within one second at small listing-thumbnail size.",
    "Use a three-layer main-image structure: (1) dominant real sellable SKU identity; (2) one strongest visual proof such as material, use, size, texture, contents, compatibility, or result; (3) at most one headline plus one short callout when exact text is allowed.",
    "Background should be clean, bright, and premium: white, soft off-white, light neutral studio, or a subtle category-relevant surface/background only when it makes the product easier to understand. Avoid busy rooms, noisy gradients, cheap color blocks, and decorative clutter.",
    "The actual sellable product must be the hero and remain the largest subject. Supporting context may appear only when it proves use, scale, function, material, or included contents; do not add generic props.",
    "No phones, coins, pens, standalone rulers, measuring cards, random gadgets, decorative furniture, or unrelated lifestyle objects.",
    "Hero framing: target about 62%-82% useful product presence so there is room for one proof element and clean copy. Preserve true product proportions and never turn a small jar, tube, bottle, pouch, or compact item into a large tub or appliance.",
    "Product pose: choose the clearest front, front-three-quarter, top-down, or category-use angle. Keep the product upright, stable, and easy to count; avoid exaggerated perspective, tilted hero drama, or beauty-advertising staging.",
    "Reference fidelity: preserve the real SKU silhouette, holes, slots, connectors, caps, handles, seams, carvings, decorative patterns, label-panel shape, color, material, finish, transparency, and surface texture from the reference images.",
    "For containers, bottles, tubes, jars, pouches, boxes, labels, or printed product packaging that are the sellable unit, show the real container/packaging cleanly as the product; preserve the layout if visible, but do not invent new readable label copy.",
    "Do not use sticker-like badges, thick arrows, icon grids, borders, price tags, fake certification marks, fake ratings, fake discounts, fake brand logos, watermarks, or dense small text.",
    "If an inset or secondary product state is useful, keep it as one clean premium detail window or one coherent secondary state, not a multi-panel collage. Do not make it look like multiple products are included unless they are.",
    "Show the product outside shipping packaging unless the packaging/container itself is the sold product, part of the included retail set, or the only visible sellable component.",
    packCount > 1
      ? `If this is a ${packCount}-piece pack, show exactly ${packCount} sellable units physically in the frame. A single exact "${packCount}PCS" text element is allowed only if it improves clarity.`
      : "For a single item, show one complete sellable unit only unless included accessories are part of the sale. If showing an open/detail state, make it clearly a product state/detail, not a second included unit.",
    context.productMode === "bundle"
      ? "For bundles, show only selected sellable bundle components, separated enough to understand what is included, without turning the main image into a dense contents infographic."
      : "",
    "If source references are weak or only size-guide/generated images, extract only verified product facts and create the cleanest truthful product hero; do not copy size-guide text, layout artifacts, props, hands, or generated-background elements.",
    "Final main-image scan: exact SKU, truthful count/components, one clear conversion proof, premium lighting, readable large text only if allowed, no clutter, no fake claims, no random props.",
  ]);
}

function buildAPlusContentRules(imageType: string) {
  if (imageType !== "lifestyle2") return [];

  return [
    "A+ CONTENT ROLE: this is a detail-page conversion module, not the MAIN image.",
    "Use a premium but realistic composition that explains trust, use context, or product value.",
    "Let image2 render only exact short text when allowed; otherwise leave clean negative space and solve the selling point visually.",
    "No fake awards, fake certifications, fake ratings, fake comparison badges, fake warranty seals, or invented brand claims.",
    "The module should feel like one coherent A+ detail-page visual block: product-first, clear benefit, polished but believable.",
  ];
}

function buildSupplementaryImageRoleRules(imageType: string) {
  if (imageType === "main") return [];

  const roleRules: Record<string, string[]> = {
    features: [
      "SUPPLEMENTARY IMAGE ROLE: explain one buying reason cluster clearly through product use, benefit proof, and a simple premium callout layout.",
      "Prefer one strong theme with 2-3 supporting signals over many unrelated claims; make every signal legible at small listing-thumbnail size.",
      "Do not duplicate the main image as a plain packshot. This image must add a reason to click or buy.",
    ],
    closeup: [
      "SUPPLEMENTARY IMAGE ROLE: prove quality through material, texture, finish, construction, connector, edge, surface, or formula detail.",
      "The close-up must still be recognizably connected to the product.",
      "Use this image to answer whether the item looks durable, well-made, cleanly finished, safe, or precise depending on category.",
    ],
    dimensions: [
      "SUPPLEMENTARY IMAGE ROLE: communicate size accurately with exact provided measurements only.",
      "If dimensions are uncertain, show the product silhouette and non-numeric proportion guides only; do not invent numbers.",
      "Absolutely no reference objects: no phone, tablet, hand, coin, pen, ruler object, car, wheel, table prop, cosmetic bottle, everyday object, or black placeholder rectangle.",
    ],
    packaging: [
      "SUPPLEMENTARY IMAGE ROLE: show delivered contents and packaging truthfully.",
      "If no real packaging is provided, use neutral unbranded packaging or show contents only; do not invent retail box design.",
      "Make included items countable and understandable; do not add manuals, cards, tools, or accessories that are not verified.",
    ],
    comparison: [
      "SUPPLEMENTARY IMAGE ROLE: clarify before/after, with/without, or product-vs-generic difference without misleading claims.",
      "Avoid fake competitor logos and avoid dense comparison tables rendered by image2.",
      "The comparison should be visually self-explanatory even if the viewer ignores the text.",
    ],
    lifestyle: [
      "SUPPLEMENTARY IMAGE ROLE: show realistic use in context, including a hand/person only when it proves use, scale, or function.",
      "This must be an actual usage moment with product interaction, environment, and buyer value visible, not the product sitting beside decorative props.",
    ],
    scene_a: [
      "SUPPLEMENTARY IMAGE ROLE: create a practical value/use proof scene for category understanding and buyer confidence.",
      "Scene A should answer the most basic buyer question with an obvious, real-world action.",
    ],
    scene_b: [
      "SUPPLEMENTARY IMAGE ROLE: create a second distinct value/use proof scene, not a duplicate of scene A.",
      "Scene B should answer a different buyer question or show a different setting, result, or interaction.",
    ],
  };

  return compactShotList([roleRules[imageType] || [], buildAPlusContentRules(imageType)]);
}

function buildLegacyImage2ProductModeRules(productMode?: ImageStudioProductMode) {
  if (productMode === "bundle") {
    return [
      "Product mode: bundle / set. Use the uploaded selected components as the sellable set.",
      "Do not include unselected background objects, props, manuals, decoration, or packaging as sellable items unless the legacy prompt explicitly requires them.",
      "Keep component relationships clear, countable, and commercially plausible.",
    ];
  }

  if (productMode === "variants") {
    return [
      "Product mode: variants. Uploaded references may be different color/spec variants of the same product family.",
      "Use only the variant or variant set requested by the legacy prompt. Do not mix unrelated variants unless the image type is a comparison or variant overview.",
    ];
  }

  return [
    "Product mode: single SKU. Treat uploaded references as the same product from different angles or detail views.",
    "Do not create extra product variants, colors, accessories, or package contents that are not in the references or the legacy prompt.",
  ];
}

function buildLegacyImage2PackRules(imageType: string, packCount: number) {
  if (packCount <= 1) return [];

  if (imageType === "main") {
    return [
      `Show exactly ${packCount} identical units of the product in the main image. The visible count must be exactly ${packCount}, not more and not fewer.`,
      `Each unit must be fully visible and countable with natural, neat spacing.`,
      "Do not add a pack-count badge, PCS text, or quantity text on the main image. Quantity must be communicated only by the visible number of sellable units.",
    ];
  }

  if (imageType === "packaging") {
    return [
      `Pack count context: this SKU is ${packCount} pieces if the legacy prompt says it is a pack.`,
      "For packaging/package-contents images, show what the customer receives when it helps clarity, but avoid a main-image style pack-count badge.",
      "If showing the full pack, keep every unit or component countable and do not add unverified accessories.",
    ];
  }

  if (imageType === "closeup" || imageType === "dimensions") {
    return [
      `Pack count context: this SKU may be ${packCount} pieces, but this image type should not force every unit into the frame.`,
      "Focus on one representative unit or one accurate detail unless the legacy prompt explicitly asks for the whole set.",
      "Do not add a PCS badge on this image type.",
    ];
  }

  return [
    `Pack count context: this SKU may be ${packCount} pieces, but do not force all units into this image unless it naturally improves buyer understanding.`,
    "Do not add a PCS badge outside the main image.",
    "For use scenes, show the product in realistic use even if only one representative unit appears.",
  ];
}

function buildImage2GalleryRoleRules(imageType: string) {
  const galleryRules: Record<string, string[]> = {
    main: [
      "Gallery role: first-click product identity image.",
      "Win the click with exact SKU identity plus one clear conversion proof, while staying premium and uncluttered.",
    ],
    features: [
      "Gallery role: SELLING POINT module.",
      "Show the strongest benefit cluster that cannot be understood from the main image alone, combining real use proof, product detail, and 1-3 large readable callouts.",
    ],
    closeup: [
      "Gallery role: MATERIAL / QUALITY proof.",
      "Show the buyer why the material, construction, finish, formula, fiber, edge, connector, or detail should be trusted.",
    ],
    dimensions: [
      "Gallery role: SIZE confidence.",
      "Reduce returns by making size and proportion clear with product-only measurement graphics, without inventing measurements or using reference objects.",
    ],
    lifestyle: [
      "Gallery role: USE proof.",
      "Show the most realistic product-use action in the buyer's life with clear interaction, not passive placement or decorative props.",
    ],
    packaging: [
      "Gallery role: PACKAGE / CONTENTS truth.",
      "Clarify package contents, bundle components, and delivery expectation truthfully.",
    ],
    comparison: [
      "Gallery role: COMPARISON / decision proof.",
      "Make a simple visual contrast that helps the buyer choose this product without fake claims or dense tables.",
    ],
    lifestyle2: [
      "Gallery role: TRUST / A+ closing image.",
      "End with trust, desirability, and a polished product-first scene that reinforces the purchase decision.",
    ],
    scene_a: [
      "Gallery role: practical value scene A.",
      "Answer the most important use/value question with a realistic action scene.",
    ],
    scene_b: [
      "Gallery role: practical value scene B.",
      "Answer a different use/value question than scene A, with a distinct setting, angle, action, or result.",
    ],
  };

  return galleryRules[imageType] || [];
}

function buildImage2GallerySetStrategyRules(context: LegacyImage2PlanContext, imageType: string) {
  const selectedTypes = context.selectedImageTypes?.length ? context.selectedImageTypes : DEFAULT_IMAGE_TYPES;
  const slotText = typeof context.planIndex === "number" && context.planCount
    ? `This is gallery image ${context.planIndex + 1} of ${context.planCount}.`
    : "";
  const chainRoles: Record<string, string> = {
    main: "identity + click reason",
    features: "selling point",
    closeup: "material / quality",
    dimensions: "size",
    lifestyle: "use",
    packaging: "package / contents",
    comparison: "comparison",
    lifestyle2: "trust / A+ close",
    scene_a: "use detail",
    scene_b: "buyer doubt / trust",
  };

  return compactShotList([
    "The whole gallery should feel like one premium, information-rich ecommerce set: consistent SKU identity, varied camera angles, varied proof roles, and no repeated filler images.",
    "Fixed gallery purchase chain: identity -> selling point -> material -> size -> use -> package -> comparison -> trust.",
    slotText,
    `Current gallery sequence: ${selectedTypes.join(" -> ")}.`,
    `Current image role in the purchase chain: ${chainRoles[imageType] || "supporting proof"}.`,
    "Each image must add new buyer information: identity, benefit, material, size, use, packaging, comparison, trust, or second use case.",
    "Do not repeat the same packshot, same angle, same scene, same text, or same proof point across the set unless the current image type specifically requires it.",
    "Use a consistent premium visual system across the set: related color palette, clean spacing, realistic product photography, and restrained high-readability typography.",
    imageType === "main"
      ? "This image opens the set: combine SKU identity with one click-driving proof, then leave deeper explanation to later images."
      : "This image must deepen the set after the main image: show information that the main image did not already explain.",
    imageType === "dimensions"
      ? "For the size step, use only product silhouette, measurement lines, and exact measurement labels; never use reference objects."
      : "",
  ]);
}

function buildImage2PremiumInformationHierarchyRules(imageType: string) {
  const shared = [
    "Premium and information-rich means controlled information hierarchy, not more clutter.",
    "Build every image with three readable layers: (1) hero product subject, (2) one visual proof element, (3) concise ecommerce copy only when allowed.",
    "Target information density: one dominant product subject, one proof scene/detail/measurement/contents/comparison element, and 1-3 short text elements when the image type allows visible text.",
    "Use editorial ecommerce typography: large, sparse, aligned, high contrast, enough margin, no tiny paragraphs, no dense bullet walls, no random badge clutter.",
    "Use a consistent premium design system across the set: neutral or product-context background, restrained product-color accents, realistic shadows, clean spacing, and repeated alignment logic.",
    "Do not use cheap visual shortcuts: thick banners, sticker bursts, clipart icon grids, loud arrows, fake UI cards, noisy gradients, random decorative props, or crowded poster layouts.",
  ];

  const typeRules: Record<string, string[]> = {
    main: [
      "Main image hierarchy: identity first, click reason second. Show the exact SKU clearly and add one visual purchase reason such as open form, included component truth, material cue, or category cue.",
      "Main should still feel like a premium ecommerce hero: no crowded infographic, no lifestyle scene unless the product category cannot be understood without a use cue, and no invented props.",
      "If text overlays are not allowed for main, the click reason must be visual, not written.",
    ],
    features: [
      "Feature image hierarchy: one major benefit, one proof visual, one headline plus up to two short supporting callouts when text is allowed.",
      "The buyer should understand the benefit in two seconds. Do not combine unrelated benefits, tiny icons, dense feature lists, or repeated use scenes.",
      "Use a premium A+ module composition: large product/action image, clean callout alignment, and enough whitespace around each information block.",
    ],
    closeup: [
      "Close-up hierarchy: macro material/form proof first, SKU continuity second, short material label only when allowed.",
      "Show one tactile detail with depth and clarity, plus a small contextual cue if needed so the buyer knows where the detail belongs on the product.",
      "Do not use generic close-up decoration, abstract texture backgrounds, or text-heavy technical posters.",
    ],
    dimensions: [
      "Dimension hierarchy: product silhouette first, precise measurement lines second, exact measurement labels third.",
      "Use product-only technical clarity: no scale props, no hands, no phones, no cars, no wheels, no packaging boxes, no comparison objects, no decorative scene.",
      "Keep labels large and minimal. If exact dimensions are not verified, use non-numeric proportion markers instead of inventing numbers.",
    ],
    lifestyle: [
      "Lifestyle hierarchy: real use action first, product visibility second, benefit copy third when allowed.",
      "The product must be actively used, held, installed, cleaned, applied, worn, stored, or displayed according to the category; avoid passive product placement.",
      "Make the scene editorial and believable, with natural scale and clear contact between user/object and product.",
    ],
    packaging: [
      "Packaging hierarchy: what the buyer receives first, count/components second, neutral packaging truth third.",
      "Use a clean unboxing or contents layout. Do not invent premium gift boxes, extra accessories, manuals, tools, or packaging copy when evidence is weak.",
      "The image should answer package contents quickly without becoming a cluttered flat lay.",
    ],
    comparison: [
      "Comparison hierarchy: decision contrast first, fair product proof second, restrained labels third.",
      "Use a clean split or paired layout with the product as the hero. Avoid red-X/green-check gimmicks, fake percentages, extreme before/after drama, or unsupported performance claims.",
      "The comparison must help the buyer decide, not attack a fake competitor.",
    ],
    lifestyle2: [
      "Trust closing hierarchy: credible finished impression first, product relevance second, one confidence message third when allowed.",
      "Make it feel like a polished A+ closing banner: aspirational but believable, calm, product-first, and consistent with the rest of the set.",
      "Do not end the set with a discount-ad look, loud claims, fake certifications, or generic lifestyle filler.",
    ],
    scene_a: [
      "Scene A hierarchy: practical use proof first, assigned buyer question second, product clarity third.",
      "Use a distinct action or angle from the feature and lifestyle images so this image adds new information.",
    ],
    scene_b: [
      "Scene B hierarchy: trust or buyer-doubt proof first, different scenario from Scene A second, concise callout third when allowed.",
      "This image should resolve a separate hesitation, not repeat the same hand/action/background as earlier images.",
    ],
  };

  return compactShotList([shared, typeRules[imageType] || []]);
}

function pickImage2TextLanguage(rawValue: unknown, imageLanguage?: string) {
  const normalized = typeof rawValue === "string" ? rawValue.replace(/\s+/g, " ").trim() : "";
  if (!normalized) return "";

  const bilingualMatch = normalized.match(/^(.*?)\s*[（(]([^（）()]*[A-Za-z][^（）()]*)[）)]\s*$/);
  if (bilingualMatch) {
    const chinese = bilingualMatch[1]?.trim() || "";
    const english = bilingualMatch[2]?.trim() || "";
    return imageLanguage === "zh" ? (chinese || english) : (english || chinese);
  }

  if (imageLanguage && imageLanguage !== "zh" && containsChineseText(normalized)) {
    const englishMatch = normalized.match(/[（(]([^（）()]*[A-Za-z][^（）()]*)[）)]/);
    return englishMatch?.[1]?.trim() || "";
  }

  return normalized;
}

function normalizeImage2VisibleText(rawValue: unknown, imageLanguage?: string, maxLength = 34) {
  let text = pickImage2TextLanguage(rawValue, imageLanguage);
  if (!text) return "";

  text = text
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/^(headline|title|caption|badge|benefit|feature|label|卖点|标题)\s*[:：-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || /^(none|null|undefined|tbd|n\/a)$/i.test(text)) return "";
  if (/https?:\/\/|www\.|@/.test(text)) return "";
  if (/[.…]/.test(text)) return "";
  if (text.length > maxLength) {
    text = text.split(/[.;。；,，|｜]/)[0]?.trim() || text;
  }
  if (text.length > maxLength) {
    const semanticLead = text.split(/\b(?:focused on|makes|helps|by showing|through|because|while|that)\b/i)[0]?.trim() || "";
    text = semanticLead.length >= 2 && semanticLead.length <= maxLength ? semanticLead : "";
  }
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount > 7 && !containsChineseText(text)) return "";
  if (text.length < 2) return "";
  return text;
}

function rewriteImage2BenefitCopy(rawValue: unknown, imageLanguage?: string) {
  const text = normalizeImage2VisibleText(rawValue, imageLanguage, 54);
  if (!text) return "";
  const lower = text.toLowerCase();

  if (/dimension|size|scale|compact|portable|storage|store|palm|small|mini|尺寸|大小|便携|收纳|掌心|小巧|小型/.test(lower)) {
    if (/store|storage|portable|收纳|便携/.test(lower)) return imageLanguage === "zh" ? "便携收纳" : "Easy to Store";
    if (/true|real|actual|palm|掌心|真实/.test(lower)) return imageLanguage === "zh" ? "真实尺寸" : "True Size";
    return imageLanguage === "zh" ? "小巧便携" : "Compact Size";
  }

  if (/deep\s*clean|deep cleaning|cleaning depth|deep reach|reach deep|深度清洁|深入清洁/.test(lower)) {
    return imageLanguage === "zh" ? "深度清洁" : "Deep Cleaning";
  }

  if (/reach|gap|narrow|corner|dead zone|spoke|rim|wheel|缝隙|死角|轮毂|轮圈|辐条|狭窄|深入/.test(lower)) {
    if (/wheel|rim|spoke|轮毂|轮圈|辐条/.test(lower)) return imageLanguage === "zh" ? "深入轮毂缝隙" : "Slim Wheel Reach";
    return imageLanguage === "zh" ? "深入狭窄缝隙" : "Slim Reach";
  }

  if (/soft|fiber|microfiber|fluffy|bristle|texture|surface|material|gentle|纤维|超细纤维|柔软|蓬松|刷毛|材质|质感/.test(lower)) {
    if (/microfiber|超细纤维/.test(lower)) return imageLanguage === "zh" ? "柔软超细纤维" : "Soft Microfiber";
    if (/bristle|刷毛/.test(lower)) return imageLanguage === "zh" ? "柔软刷毛" : "Soft Bristles";
    return imageLanguage === "zh" ? "真实材质" : "Real Texture";
  }

  if (/cream|paste|formula|open|lid|jar|膏|膏体|质地|开盖|圆罐/.test(lower)) {
    if (/open|lid|开盖/.test(lower)) return imageLanguage === "zh" ? "开盖可见" : "Open Jar";
    return imageLanguage === "zh" ? "膏体质地" : "Cream Texture";
  }

  if (/clean|wipe|brush|wash|apply|use|easy|quick|daily|护理|清洁|擦拭|刷洗|涂抹|易用|日常/.test(lower)) {
    if (/car|auto|vehicle|汽车|车/.test(lower)) return imageLanguage === "zh" ? "日常汽车护理" : "Daily Car Care";
    if (/quick|easy|simple|快速|易用|简单/.test(lower)) return imageLanguage === "zh" ? "轻松使用" : "Easy to Use";
    return imageLanguage === "zh" ? "日常清洁" : "Everyday Cleaning";
  }

  if (/gift|decor|home|desk|wall|vanity|mirror|礼品|装饰|家居|桌面|墙面|梳妆|镜/.test(lower)) {
    if (/gift|礼品|送礼/.test(lower)) return imageLanguage === "zh" ? "适合作礼品" : "Gift Ready";
    if (/wall|墙|壁挂/.test(lower)) return imageLanguage === "zh" ? "墙面装饰" : "Wall Decor";
    return imageLanguage === "zh" ? "精致装饰" : "Decor Accent";
  }

  return text;
}

function isWeakImage2Copy(rawValue: string, imageType: string) {
  const text = rawValue.trim();
  if (!text) return true;
  if (/[?？]/.test(text)) return true;
  if (/^(buyers?|shoppers?|users?|need to|must|do not|don't|avoid|if shown|if photographed|show|prove|answer|risk|warning)\b/i.test(text)) return true;
  if (/buyer|shopper|question|risk|avoid|mislead|misleading|unverified|fake|claim|damage|paint loss|deep scratch|oversized|bulky/i.test(text)) return true;
  if (/^(can|is|are|what|how|why|whether)\b/i.test(text)) return true;
  if (imageType !== "dimensions" && /\d+(?:\.\d+)?\s*(?:cm|mm|m|in|inch|inches)\b/i.test(text)) return true;
  if (!containsChineseText(text) && text.split(/\s+/).filter(Boolean).length > 4) return true;
  if (containsChineseText(text) && text.length > 10) return true;
  return false;
}

function extractImage2Measurements(rawValue: unknown) {
  const text = typeof rawValue === "string" ? rawValue : "";
  return dedupeTextList(
    text.match(/\d+(?:\.\d+)?\s*(?:cm|mm|m|in|inch|inches|厘米|毫米|米|英寸)\b(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:cm|mm|m|in|inch|inches|厘米|毫米|米|英寸)\b)?/gi) || [],
  ).slice(0, 4);
}

function extractSuggestedBadgeText(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return [record.badge, record.benefit, record.painPoint].filter((value): value is string => typeof value === "string");
  });
}

function buildImage2GeneratedTextCandidates(
  plan: ImageStudioPlan,
  context: LegacyImage2PlanContext,
  packCount: number,
  basePrompt: string,
) {
  const imageType = plan.imageType;
  const analysis = context.analysis;
  const imageLanguage = context.imageLanguage;
  const sellingPoints = compactShotList([analysis?.sellingPoints, analysis?.operatorInsights?.sellingPoints]);
  const purchaseDrivers = compactShotList([analysis?.operatorInsights?.purchaseDrivers]);
  const proofPoints = compactShotList([analysis?.operatorInsights?.proofPoints]);
  const allocation = buildLegacyImage2InsightAllocation(imageType, context);
  const allocationTheme = allocation.theme;
  const themeSellingPoints = allocationTheme
    ? selectInsightItems(sellingPoints, getLegacyImage2ThemeKeywords(allocationTheme), 2, null)
    : [];
  const allocatedBenefitText = compactShotList([
    allocation.purchaseDrivers,
    allocation.proofPoints,
    themeSellingPoints.length ? themeSellingPoints : [],
  ]);
  const suggestedBadges = compactShotList([
    extractSuggestedBadgeText(analysis?.suggestedBadges),
    extractSuggestedBadgeText(analysis?.creativeDirection?.suggestedBadges),
  ]);
  const planText = compactShotList([
    plan.headline,
    plan.subheadline,
    plan.title,
    getPlanStringList(plan, "allowedText"),
    getPlanStringList(plan, "overlayAllowedText"),
  ]);
  const quotedPromptText = dedupeTextList(
    Array.from(basePrompt.matchAll(/["“]([^"“”]{2,34})["”]/g)).map((match) => match[1] || ""),
  ).slice(0, 3);

  const commonBenefits = imageType === "features"
    ? [planText, allocatedBenefitText, suggestedBadges, quotedPromptText]
    : [planText, sellingPoints, purchaseDrivers, proofPoints, suggestedBadges, quotedPromptText];
  const candidatesByType: Record<string, unknown[]> = {
    main: [
      packCount > 1 ? `${packCount}PCS` : "",
      planText,
      allocatedBenefitText,
      suggestedBadges,
    ],
    features: [planText, allocatedBenefitText, suggestedBadges, quotedPromptText],
    closeup: [planText, allocation.proofPoints.length ? allocation.proofPoints : proofPoints.slice(0, 1), sellingPoints.slice(0, 1)],
    dimensions: [
      "Size Guide",
      extractImage2Measurements(analysis?.estimatedDimensions),
      extractImage2Measurements(analysis?.productFacts?.estimatedDimensions),
      extractImage2Measurements(basePrompt),
    ],
    lifestyle: [planText, sellingPoints.slice(0, 1), allocation.purchaseDrivers.length ? allocation.purchaseDrivers : purchaseDrivers.slice(0, 1)],
    packaging: [
      packCount > 1 || context.productMode === "bundle" ? "Included Items" : "Single Unit",
      packCount > 1 ? `${packCount}PCS` : "",
      planText,
    ],
    comparison: [planText, allocation.purchaseDrivers.length ? allocation.purchaseDrivers : sellingPoints.slice(0, 1)],
    lifestyle2: [planText, sellingPoints.slice(-1), allocation.purchaseDrivers.length ? allocation.purchaseDrivers : purchaseDrivers.slice(-1)],
    scene_a: [planText, allocation.purchaseDrivers.length ? allocation.purchaseDrivers : sellingPoints.slice(0, 1)],
    scene_b: [planText, allocation.purchaseDrivers.length ? allocation.purchaseDrivers : sellingPoints.slice(1, 2)],
  };

  const normalizedCandidates = compactShotList(candidatesByType[imageType] || commonBenefits)
    .map((text) => {
      const normalized = normalizeImage2VisibleText(text, imageLanguage, imageType === "dimensions" ? 24 : 34);
      if (imageType === "dimensions") return normalized;
      return rewriteImage2BenefitCopy(normalized || text, imageLanguage);
    })
    .filter(Boolean)
    .filter((text) => !isWeakImage2Copy(text, imageType));

  const maxTextCount = imageType === "dimensions" ? 5 : imageType === "features" ? 3 : 4;
  const dedupedCandidates = dedupeTextList(normalizedCandidates);
  if (imageType === "main") return dedupedCandidates.slice(0, packCount > 1 ? 2 : 2);
  if (imageType === "features") return dedupedCandidates.slice(0, Math.min(3, maxTextCount));
  if (imageType === "closeup") return dedupedCandidates.slice(0, 2);
  if (imageType === "packaging") return dedupedCandidates.slice(0, packCount > 1 || context.productMode === "bundle" ? 3 : 2);
  if (imageType === "comparison") return dedupedCandidates.slice(0, 2);
  return dedupedCandidates.slice(0, maxTextCount);
}

function buildLegacyImage2TypeRules(imageType: string, packCount: number) {
  const label = IMAGE_TYPE_LABELS[imageType] || imageType;
  const baseRules = [
    `Current image type: ${label} (${imageType}).`,
    "Create a photorealistic commercial ecommerce product image, not an illustration or generic concept art.",
    "The product must be understandable at thumbnail size and remain the visual hero.",
  ];

  const typeRules: Record<string, string[]> = {
    main: [
      "Main image: premium conversion hero. It should be more informative than a plain packshot but much cleaner than a poster.",
      "Use one coherent ecommerce hero layout: product-dominant composition, clean premium background, one visual proof element, and optional restrained large text from the allowed list.",
      "The main image should sell the SKU by clarity plus one reason to click: one glance should reveal product category, included components, pack quantity when applicable, color/material, real scale impression, and the strongest buyer benefit.",
      "Do not add phones, coins, pens, measuring cards, standalone rulers, random gadgets, decorative furniture, busy lifestyle props, fake packaging, or unrelated scale props.",
      "Do not add cheap badges, arrows, icon grids, borders, price tags, fake certification marks, fake discount stickers, dense poster text, or tiny unreadable captions.",
      packCount > 1
        ? `For this main image, the visible physical product count must be exactly ${packCount}; optional text may only use the exact allowed "${packCount}PCS" wording once.`
        : "For this main image, show one complete sellable unit unless the product facts explicitly include accessories or bundle contents. A secondary open/detail state is allowed only if it reads as a detail proof, not a multi-pack.",
    ],
    features: [
      "Feature image: show one key buyer benefit cluster visually through clear product use, material proof, function, outcome, or problem-solution composition.",
      "Use only the assigned feature cluster from BUYER INTENT and SCENE AND ACTION; include 2-3 related information signals inside that cluster when useful.",
      "Use one large image2-rendered headline plus up to two short callouts only when visible text rules provide exact text.",
      "Keep callouts minimal, large, and readable; avoid dense poster-style copy, feature walls, cheap arrows, tiny icon grids, and unrelated claim stacking.",
      "Do not use the same composition as lifestyle, scene A, or scene B. This should look like a designed selling-point module, not another raw use photo.",
      "The product must remain the largest visual subject; do not let text, icons, or decorative graphics become the hero.",
    ],
    closeup: [
      "Close-up detail image: focus on one representative unit or one important area of the product.",
      "Show material, texture, edge, connector, surface, finish, or functional detail with macro-like clarity.",
      "When useful, include one secondary crop/detail cue or one short material label so the close-up carries more product information without becoming a poster.",
      "Do not turn the detail image into a pack-count overview.",
      "Do not beautify the close-up into a different material, color, formula, connector, stitching, grain, or surface than the reference.",
    ],
    dimensions: [
      "Dimension image: show size/scale only with exact dimensions from the legacy prompt or uploaded reference.",
      "Do not invent measurements. If exact dimensions are not provided, show product proportion guides without numeric labels.",
      "If exact size text is available, image2 should render it directly as clean large measurement labels.",
      "Strict dimension composition: product only, white/light neutral background, thin measurement lines, exact labels. No other object may appear.",
      "Do not use phones, smartphones, tablets, laptops, black rectangles, coins, pens, ruler objects, hands, people, cars, wheels, table props, boxes, packaging, or random props as size references.",
      "Measurement arrows or guide lines must be simple, aligned, and tied to real product edges; no cluttered ruler graphics, no standalone ruler object, and no comparison object.",
    ],
    lifestyle: [
      "Lifestyle scene: show the product being used naturally in a realistic target scenario.",
      "A person, hand, or body part may appear when it directly proves use, size, or function; keep interaction anatomically natural.",
      "Do not make the product a tiny background decoration.",
      "The scene must answer how the product is used, where it belongs, or why the buyer needs it.",
      "Do not repeat the feature image composition. Use a wider or more natural real-use moment with less graphic layout.",
      "Avoid fantasy rooms, luxury sets, impossible reflections, unrealistic scale, and props that hide the product.",
    ],
    packaging: [
      "Packaging image: show actual delivered contents or a clean package-content arrangement.",
      "Do not invent branded boxes, premium inserts, manuals, certifications, warranty cards, or extra accessories.",
      "If real packaging is not provided, use neutral packaging or focus on product contents instead of fake package design.",
      "Make every included sellable component countable and separated enough for buyers to understand the order contents.",
      "Even for a single-unit SKU, clarify the truthful received item, container, included components if verified, and packaging absence/presence in a clean premium layout.",
      "Do not use packaging to upgrade perceived value beyond the evidence in the references.",
    ],
    comparison: [
      "Comparison image: make the difference visually understandable without exaggerated claims.",
      "Use honest before/after, with/without, old/new, or product-vs-generic comparison only when the legacy prompt supports it.",
      "Use only short image2-rendered comparison labels from the visible text rules; do not create dense small comparison text or loud before/after advertising.",
      "Keep both sides visually fair: same camera distance, similar lighting, no fake competitor logos, no impossible transformation, no exaggerated dirty-vs-perfect drama.",
    ],
    lifestyle2: [
      "A+ closing image: create a polished final ecommerce scene that reinforces trust, use context, and product desirability.",
      "Use a real-life scene or clean premium product setup; avoid marketing poster clutter.",
      "Do not add fake badges, awards, certifications, or brand claims.",
      "This image can feel more editorial than the main image, but the product still needs to be inspectable and faithful.",
      "Use only exact short image2-rendered text when allowed; otherwise rely on composition and scene proof.",
    ],
    scene_a: [
      "Price-review scene A: make the product category, function, material, and value easy to understand.",
      "Use a realistic use/action scene rather than a static decorative placement.",
      "Avoid over-luxury styling that makes cost, material, or function misleading.",
      "Pick the most common buyer-use scenario and show one clear interaction with the product. Do not duplicate lifestyle composition.",
    ],
    scene_b: [
      "Price-review scene B: create a second realistic use/value scene with a clearly different angle, environment, or action from scene A.",
      "Show practical use, size, material, or result proof without fake claims.",
      "Avoid over-luxury styling that makes cost, material, or function misleading.",
      "Do not repeat scene A or lifestyle with a small variation; change the buyer question, proof point, camera distance, or product state.",
    ],
  };

  return compactShotList([
    baseRules,
    typeRules[imageType] || [],
    buildLegacyImage2PackRules(imageType, packCount),
  ]);
}

function buildImage2TextByTypeRules(imageType: string) {
  const rules: Record<string, string[]> = {
    features: [
      "Feature text layout: premium and restrained, at most one headline plus two short supporting callouts.",
      "Text should name the shopper benefit in plain product language, while the image proves it visually.",
    ],
    closeup: [
      "Close-up text layout: use at most two short material/detail labels only when exact text is available.",
      "Do not cover the material/detail area with text.",
    ],
    dimensions: [
      "Dimension text layout: measurement labels only, aligned to simple guide lines.",
      "Do not render descriptive marketing copy on dimension images.",
      "Do not render labels for any scale object because no scale object is allowed.",
    ],
    lifestyle: [
      "Lifestyle text layout: if exact text is available, use one short headline and optionally one tiny-but-readable support label away from the product and hand/action.",
    ],
    packaging: [
      "Packaging text layout: prefer clean contents photography; use only exact item-count or included-content text when the product is a bundle or pack.",
      "Do not invent product label copy, certification marks, instruction cards, or branded box text.",
    ],
    comparison: [
      "Comparison text layout: use no text or two restrained labels at most; avoid loud before/after advertising.",
      "No dense comparison tables, rating rows, fake percentages, red warning marks, or tiny footnotes.",
    ],
    lifestyle2: [
      "A+ text layout: one short benefit headline plus one supporting value phrase is allowed only when exact text is available; otherwise keep clean negative space.",
    ],
    scene_a: [
      "Scene A text layout: use one short exact value phrase when it helps; the action scene should carry most of the message.",
    ],
    scene_b: [
      "Scene B text layout: use one short exact value phrase that differs from scene A when it helps.",
    ],
  };

  return rules[imageType] || [];
}

function buildLegacyImage2TextRules(
  plan: ImageStudioPlan,
  context: LegacyImage2PlanContext,
  packCount: number,
  basePrompt: string,
) {
  const imageType = plan.imageType;
  const allowedText = buildImage2GeneratedTextCandidates(plan, context, packCount, basePrompt);

  if (imageType === "main") {
    return compactShotList([
      "MAIN image visible text policy: image2 may render a very small amount of premium ecommerce text directly inside the final image. No local text overlay or post-production text layer will be added.",
      "Use at most one large headline plus one short supporting callout. Text must be large, clean, sparse, and useful at small listing-thumbnail size.",
      "Allowed main-image text must come only from the exact allowed text list below. Do not invent slogans, claims, certifications, warranty text, discount words, brand names, or label copy.",
      allowedText.length
        ? [
          `Required/allowed image2-rendered main text: ${allowedText.map((text) => `"${text}"`).join(", ")}.`,
          `Use these exact words only. Render 1-${Math.min(allowedText.length, 2)} short text elements depending on the layout.`,
        ].join(" ")
        : "If no exact short text is available, use the clean visual proof without readable marketing text.",
      "Do not render arrows, icon grids, dense bullets, tiny captions, price text, fake ratings, fake seals, watermarks, or random letters.",
      "Only preserve real readable text physically printed on the actual product or actual packaging when clearly visible in a real product reference. If no verified real label text exists, use blank/non-readable label areas or simple graphic color bands instead of fake readable words.",
      "Place text in clean negative space away from the product edges, hands, use action, and important material/detail areas.",
    ]);
  }

  return compactShotList([
    "Image2 should generate the visible ecommerce text directly inside the final image. No local text overlay or post-production text layer will be added.",
    "Visible text must be minimal, deliberate, large, premium, and commercially useful. If text makes the image feel like a cheap poster, use fewer words.",
    "Write on-image copy like a premium product benefit headline, not an internal analysis note. Do not render buyer-research wording such as \"buyers want\", \"need to prove\", \"risk\", \"question\", or full explanatory sentences.",
    "Each benefit phrase should be short enough to read in a small listing thumbnail: usually 2-4 English words or one short Chinese phrase.",
    "Preserve readable product/package text only when it is clearly visible in the uploaded reference or explicitly written in the legacy prompt.",
    "If readable text is not visible or provided, do not invent brand names, label copy, container copy, slogans, certifications, warnings, ingredient panels, warranty text, or package copy.",
    "When a label area is needed but no exact text is provided, use blank label space or non-readable graphic bands instead of fake readable words.",
    allowedText.length
      ? [
        `Required/allowed image2-rendered text: ${allowedText.map((text) => `"${text}"`).join(", ")}.`,
        `Use these exact words only. Render 1-${Math.min(allowedText.length, imageType === "features" ? 3 : 4)} short text elements depending on the layout.`,
      ].join(" ")
      : "If no exact short text is available, use the clean visual scene without readable marketing text.",
    buildImage2TextByTypeRules(imageType),
    imageType === "dimensions"
      ? "For size labels, render only exact visible measurements from the allowed text list. Do not invent numbers."
      : "",
    "Place generated text as large readable ecommerce callouts, title labels, or simple comparison labels; do not place invented text on the physical product label unless it is verified.",
    "No watermark, no fake logo, no fake certification mark, no random letters, no dense small text, no tiny unreadable paragraphs.",
  ]);
}

function buildLegacyImage2ReferenceBlock(context: LegacyImage2PlanContext) {
  const referenceImages = context.referenceImages?.length
    ? context.referenceImages
    : buildImage2ReferenceImages([], context.productMode);

  return [
    formatImage2ReferenceImages(referenceImages),
    "If an uploaded image is a size guide, info sheet, screenshot, or generated mockup rather than a real product photo, use it only for verified product facts and composition hints. Do not copy unrelated props or invent packaging/labels from it.",
  ].join("\n");
}

function buildLegacyImage2AdapterPrompt(
  plan: ImageStudioPlan,
  basePrompt: string,
  context: LegacyImage2PlanContext,
) {
  const clampedPack = Math.max(1, Math.min(12, Math.floor(context.packCount || 1)));
  const sanitizedBasePrompt = sanitizeLegacyImage2BasePrompt(basePrompt, plan.imageType);
  const typeRules = buildLegacyImage2TypeRules(plan.imageType, clampedPack);
  const textRules = buildLegacyImage2TextRules(plan, context, clampedPack, sanitizedBasePrompt);
  const productModeRules = buildLegacyImage2ProductModeRules(context.productMode);
  const productFacts = buildLegacyImage2ProductFacts(context);
  const planAllocationRules = buildLegacyImage2PlanAllocationRules(context, plan.imageType);
  const premiumVisualRules = buildLegacyImage2PremiumVisualRules(plan.imageType);
  const premiumInformationRules = buildImage2PremiumInformationHierarchyRules(plan.imageType);
  const buyerIntentRules = buildLegacyImage2BuyerIntentRules(context, plan.imageType);
  const gallerySetStrategyRules = buildImage2GallerySetStrategyRules(context, plan.imageType);
  const galleryRoleRules = buildImage2GalleryRoleRules(plan.imageType);
  const usageActionRules = buildLegacyImage2UsageActionRules(plan, context);
  const compositionRules = buildLegacyImage2CompositionRules(plan.imageType);
  const iterationRules = buildLegacyImage2IterationRules(plan, sanitizedBasePrompt);
  const referenceReliabilityRules = buildReferenceReliabilityRules(context);
  const listingRoleRules = plan.imageType === "main"
    ? buildMainImageComplianceRules(context, clampedPack)
    : buildSupplementaryImageRoleRules(plan.imageType);
  const antiPhonePropRules = isPhoneRelevantProduct(context)
    ? [
      "Phone/device context is allowed only when it directly demonstrates the product's real phone/device function, fit, charging, mounting, or compatibility.",
    ]
    : [
      "Do not include any phone, smartphone, tablet, laptop, screen device, charger, cable, or electronic gadget anywhere in the image.",
      "Do not use a phone as a size reference, hand prop, desk prop, lifestyle prop, background object, or decorative object.",
      "If the legacy prompt asks for a phone/coin/ruler/pen scale comparison, ignore that request unless this product is actually a phone/device accessory.",
    ];

  return [
    LEGACY_IMAGE2_ADAPTER_MARKER,
    "Use the legacy AI image prompt below as the creative brief, but render it with GPT-Image-2 production structure: scene/background -> product subject -> key details -> constraints. No separate mode is required; the current image type decides the rules.",
    "",
    "TASK",
    formatShotBriefList(compactShotList([
      "Create one finished Temu-ready ecommerce product image.",
      `Image type: ${IMAGE_TYPE_LABELS[plan.imageType] || plan.imageType} (${plan.imageType}).`,
      context.salesRegion ? `Target market: ${context.salesRegion}.` : "",
      context.imageLanguage ? `Visible language preference: ${context.imageLanguage}.` : "",
      context.imageSize ? `Requested canvas: ${context.imageSize}.` : "",
      "Prioritize click-through clarity, product fidelity, and conversion usefulness over decorative styling.",
    ])),
    "",
    "REFERENCE IMAGES",
    buildLegacyImage2ReferenceBlock(context),
    "",
    "REFERENCE RELIABILITY",
    formatShotBriefList(referenceReliabilityRules),
    "",
    "PRODUCT FACTS",
    formatShotBriefList(productFacts),
    "",
    "PRODUCT MODE",
    formatShotBriefList(productModeRules),
    "",
    "PLAN ALLOCATION",
    formatShotBriefList(planAllocationRules),
    "",
    "PREMIUM VISUAL DIRECTION",
    formatShotBriefList(premiumVisualRules),
    "",
    "PREMIUM INFORMATION HIERARCHY",
    formatShotBriefList(premiumInformationRules),
    "",
    "BUYER INTENT",
    formatShotBriefList(buyerIntentRules),
    "",
    "GALLERY SET STRATEGY",
    formatShotBriefList(gallerySetStrategyRules),
    "",
    "GALLERY SET ROLE",
    formatShotBriefList(galleryRoleRules),
    "",
    "PRODUCT FIDELITY",
    formatShotBriefList([
      "Preserve the real product identity from the uploaded references.",
      "Keep geometry, shape, proportions, color, material, surface texture, finish, and functional structure faithful to the reference images.",
      "Do not add new product parts, accessories, variants, logos, labels, claims, certifications, or package elements that are not visible or explicitly described.",
      ...antiPhonePropRules,
      "Across all gallery images, the SKU should look like the same real product; only background, camera, action, and layout may change by image type.",
      "For non-main images, usage scenes and graphics may explain value, but they must not redesign the product, change its category, or exaggerate its size/function.",
      "Background, lighting, camera angle, and scene may be improved for ecommerce, but the product itself must not drift.",
    ]),
    "",
    "LISTING IMAGE ROLE",
    formatShotBriefList(listingRoleRules),
    "",
    "SCENE AND ACTION",
    formatShotBriefList(usageActionRules),
    "",
    "COMPOSITION AND CAMERA",
    formatShotBriefList(compositionRules),
    "",
    "IMAGE TYPE RULES",
    formatShotBriefList(typeRules),
    "",
    "VISIBLE TEXT RULES",
    formatShotBriefList(textRules),
    "",
    "LEGACY AI IMAGE PROMPT",
    sanitizedBasePrompt || "Use the uploaded product references to create the requested ecommerce product image.",
    "",
    "IMAGE2 FINAL RULES",
    formatShotBriefList([
      "If the legacy prompt conflicts with the adapter, the adapter wins for product fidelity, text, dimensions, packaging, count, and image-type behavior.",
      ...iterationRules,
      "Keep the image clean, realistic, commercially plausible, and immediately understandable to a cross-border ecommerce shopper.",
      "Output only the final image; do not create a collage unless the image type or legacy prompt explicitly asks for one.",
    ]),
  ].join("\n");
}

function buildLegacyImage2Plan(
  plan: ImageStudioPlan,
  contextOrPackCount: number | LegacyImage2PlanContext = {},
): ImageStudioPlan {
  const sourcePrompt = getShotBriefSourcePrompt(plan) || String(plan.prompt || "").trim();
  const basePrompt = unwrapLegacyImage2AdapterPrompt(sourcePrompt);
  const context = normalizeLegacyImage2PlanContext(contextOrPackCount);
  const prompt = buildLegacyImage2AdapterPrompt(plan, basePrompt, context);

  return {
    ...plan,
    prompt,
    promptSource: IMAGE2_ECOMMERCE_PLAN_SOURCE,
    compiledPrompt: undefined,
    shotBrief: undefined,
    layout: undefined,
    lang: undefined,
  };
}

function buildLegacyImage2Plans(plans: ImageStudioPlan[], contextOrPackCount: number | LegacyImage2PlanContext = {}) {
  const baseContext = normalizeLegacyImage2PlanContext(contextOrPackCount);
  const selectedImageTypes = plans.map((plan) => plan.imageType).filter(Boolean);
  return plans.map((plan, planIndex) => buildLegacyImage2Plan(plan, {
    ...baseContext,
    selectedImageTypes,
    planIndex,
    planCount: plans.length,
  }));
}

const IMAGE2_ADAPTER_SECTION_HEADINGS = [
  "TASK",
  "REFERENCE IMAGES",
  "REFERENCE RELIABILITY",
  "PRODUCT FACTS",
  "PRODUCT MODE",
  "PLAN ALLOCATION",
  "PREMIUM VISUAL DIRECTION",
  "PREMIUM INFORMATION HIERARCHY",
  "BUYER INTENT",
  "GALLERY SET STRATEGY",
  "GALLERY SET ROLE",
  "PRODUCT FIDELITY",
  "LISTING IMAGE ROLE",
  "SCENE AND ACTION",
  "COMPOSITION AND CAMERA",
  "IMAGE TYPE RULES",
  "VISIBLE TEXT RULES",
  "LEGACY AI IMAGE PROMPT",
  "IMAGE2 FINAL RULES",
];

function extractImage2AdapterSection(prompt: string, heading: string) {
  const sectionStart = prompt.indexOf(`\n${heading}\n`);
  const startIndex = sectionStart >= 0
    ? sectionStart + heading.length + 2
    : prompt.startsWith(`${heading}\n`)
      ? heading.length + 1
      : -1;
  if (startIndex < 0) return "";

  const nextHeadingIndex = IMAGE2_ADAPTER_SECTION_HEADINGS
    .filter((candidate) => candidate !== heading)
    .map((candidate) => prompt.indexOf(`\n${candidate}\n`, startIndex))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  return prompt
    .slice(startIndex, typeof nextHeadingIndex === "number" ? nextHeadingIndex : undefined)
    .trim();
}

function summarizeImage2PlanForLog(plan: ImageStudioPlan) {
  const prompt = String(plan.prompt || "");
  const visibleTextSection = extractImage2AdapterSection(prompt, "VISIBLE TEXT RULES");
  const allowedTextMatch = visibleTextSection.match(/Required\/allowed image2-rendered text: ([^\n]+)/);
  return {
    imageType: plan.imageType,
    promptSource: plan.promptSource || "",
    promptLength: prompt.length,
    planAllocation: extractImage2AdapterSection(prompt, "PLAN ALLOCATION"),
    premiumVisual: extractImage2AdapterSection(prompt, "PREMIUM VISUAL DIRECTION"),
    premiumInformation: extractImage2AdapterSection(prompt, "PREMIUM INFORMATION HIERARCHY"),
    sceneAndAction: extractImage2AdapterSection(prompt, "SCENE AND ACTION").split(/\r?\n/).slice(0, 8).join("\n"),
    allowedText: allowedTextMatch?.[1]?.trim() || "",
    legacyNoise: {
      commercialAnalysis: prompt.includes("COMMERCIAL ANALYSIS"),
      blankZones: prompt.includes("BLANK ZONES"),
      noTextPipeline: prompt.includes("NO TEXT IN IMAGE"),
      regionalStyle: prompt.includes("REGIONAL STYLE"),
      realWorldScaleLock: prompt.includes("REAL-WORLD SCALE LOCK"),
    },
  };
}

function logImage2PlanDiagnostics(stage: string, plans: ImageStudioPlan[]) {
  if (plans.length === 0) return;
  console.info("[ImageStudioGPT][image2-plan]", {
    stage,
    count: plans.length,
    plans: plans.map(summarizeImage2PlanForLog),
  });
}

function isDesignerEnhancedPlan(plan: ImageStudioPlan) {
  return plan.designerSource === DESIGNER_PLAN_SOURCE || plan.designerEnhanced === true;
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

function formatStrategyNameForPreview(value?: string) {
  if (!value) return "";
  const labels: Record<string, string> = {
    "mirror-reflection-proof": "镜面使用证明",
    "home-placement-proof": "家居摆放证明",
    "wearable-fit-proof": "佩戴/尺码证明",
    "utility-operation-proof": "功能操作证明",
    "beauty-care-result-proof": "个护使用证明",
    "electronics-function-proof": "数码功能证明",
    "toy-play-safety-proof": "玩具玩法证明",
    "pet-use-proof": "宠物使用证明",
    "auto-care-repair-proof": "汽车养护使用证明",
    "auto-outdoor-fit-proof": "车载/户外适配证明",
    "universal-ecommerce-proof": "通用电商证明",
    identity_proof: "主体识别",
    benefit_proof: "卖点证据",
    material_detail_proof: "材质细节",
    scale_proof: "尺寸比例",
    use_case_proof: "使用场景",
    delivery_gift_proof: "包装/礼品",
    choice_proof: "选择对比",
    operation_proof: "操作说明",
    objection_proof: "疑虑解除",
    context_fit_proof: "场景适配",
    bundle_main: "套装件数优先",
    scale_main: "尺寸真实优先",
    use_hint_main: "轻使用提示",
    gift_main: "礼品氛围",
    identity_main: "一眼识别",
    premium_main: "高级点击感",
  };
  return labels[value] || value.replace(/[_-]+/g, " ");
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
    plan.shotBrief?.categoryStrategy
      ? `商品策略：${formatStrategyNameForPreview(plan.shotBrief.categoryStrategy)}。`
      : "",
    plan.shotBrief?.proofType
      ? `本图任务：${formatStrategyNameForPreview(plan.shotBrief.proofType)}。`
      : "",
    plan.shotBrief?.mainImageStrategy
      ? `主图策略：${formatStrategyNameForPreview(plan.shotBrief.mainImageStrategy.strategyName)}。`
      : "",
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

export default function ImageStudioGPT() {
  const location = useLocation();
  const [status, setStatus] = useState<ImageStudioStatus>(FALLBACK_STATUS);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<ImageStudioHistorySummary[]>([]);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [productMode, setProductMode] = useState<ImageStudioProductMode>("single");
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
  const [componentPreview, setComponentPreview] = useState<ComponentBundlePreviewState | null>(null);
  const [preparedComponentBundle, setPreparedComponentBundle] = useState<PreparedComponentBundleState | null>(null);
  const [selectedComponentIds, setSelectedComponentIds] = useState<number[]>([]);
  const [analysis, setAnalysis] = useState<ImageStudioAnalysis>(EMPTY_IMAGE_STUDIO_ANALYSIS);
  const [plans, setPlans] = useState<ImageStudioPlan[]>([]);
  const [results, setResults] = useState<ResultStateMap>({});
  const [imageVariants, setImageVariants] = useState<ImageVariantMap>({});
  const [activeVariantIds, setActiveVariantIds] = useState<Record<string, string>>({});
  const [redrawSuggestions, setRedrawSuggestions] = useState<Record<string, string>>({});
  const [openRedrawComposerFor, setOpenRedrawComposerFor] = useState<string | null>(null);
  const [detectingComponents, setDetectingComponents] = useState(false);
  const [preparingComponentBundle, setPreparingComponentBundle] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [designerRunning, setDesignerRunning] = useState(false);
  const [designerResult, setDesignerResult] = useState<DesignerResult | null>(null);
  const [designerDrawerOpen, setDesignerDrawerOpen] = useState(false);
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

  const clearComponentBundleSelection = () => {
    setComponentPreview(null);
    setPreparedComponentBundle(null);
    setSelectedComponentIds([]);
  };

  const primaryUploadFile = uploadFiles[0]?.originFileObj instanceof File ? uploadFiles[0].originFileObj : null;
  const isSingleUploadSource = uploadFiles.length === 1 && Boolean(primaryUploadFile);
  const componentPreviewMatchesUpload = Boolean(
    componentPreview
    && uploadFiles[0]
    && componentPreview.sourceFileUid === uploadFiles[0].uid,
  );
  const selectedBundleComponents = useMemo(() => {
    if (!componentPreviewMatchesUpload || !componentPreview) return [];
    const selectedSet = new Set(selectedComponentIds);
    return componentPreview.components.filter((component) => selectedSet.has(component.id));
  }, [componentPreview, componentPreviewMatchesUpload, selectedComponentIds]);
  const componentBundleActive = selectedBundleComponents.length >= 2;
  const componentBundleLabel = componentBundleActive
    ? buildComboLabel(selectedBundleComponents.map((component) => component.id))
    : "";
  const preparedComponentBundleMatchesSelection = Boolean(
    preparedComponentBundle
    && uploadFiles[0]
    && preparedComponentBundle.sourceFileUid === uploadFiles[0].uid
    && preparedComponentBundle.selectionKey === componentBundleLabel,
  );
  useEffect(() => {
    if (!uploadFiles[0]) {
      clearComponentBundleSelection();
      return;
    }
    if (uploadFiles.length !== 1) {
      clearComponentBundleSelection();
      return;
    }
    if (componentPreview && componentPreview.sourceFileUid !== uploadFiles[0].uid) {
      clearComponentBundleSelection();
    }
  }, [componentPreview, uploadFiles]);

  useEffect(() => {
    let cancelled = false;

    const prepareSelectedBundle = async () => {
      if (!componentBundleActive || !primaryUploadFile || !uploadFiles[0]) {
        setPreparedComponentBundle(null);
        setPreparingComponentBundle(false);
        return;
      }

      setPreparingComponentBundle(true);
      try {
        const croppedFiles = await cropDetectedComponentsToFiles(primaryUploadFile, selectedBundleComponents);
        const items = await Promise.all(
          croppedFiles.map(async (file, index) => ({
            component: selectedBundleComponents[index],
            file,
            previewUrl: await readFileAsDataUrl(file),
          })),
        );

        if (cancelled) return;
        setPreparedComponentBundle({
          sourceFileUid: uploadFiles[0].uid,
          selectionKey: componentBundleLabel,
          items: items.filter((item) => item.component),
        });
      } catch (error) {
        if (!cancelled) {
          setPreparedComponentBundle(null);
          message.error(error instanceof Error ? error.message : "组合装裁剪预览失败");
        }
      } finally {
        if (!cancelled) {
          setPreparingComponentBundle(false);
        }
      }
    };

    prepareSelectedBundle();

    return () => {
      cancelled = true;
    };
  }, [componentBundleActive, componentBundleLabel, primaryUploadFile, selectedBundleComponents, uploadFiles]);

  const resolveImageStudioSourceFiles = async () => {
    const originalFiles = collectOriginFiles(uploadFiles);
    if (originalFiles.length === 0) {
      throw new Error("请先上传商品素材图");
    }

    if (componentBundleActive && primaryUploadFile) {
      const preparedFiles = preparedComponentBundleMatchesSelection
        ? preparedComponentBundle?.items.map((item) => item.file).filter((item): item is File => item instanceof File) || []
        : [];
      const croppedFiles = preparedFiles.length >= 2
        ? preparedFiles
        : await cropDetectedComponentsToFiles(primaryUploadFile, selectedBundleComponents);
      if (croppedFiles.length < 2) {
        throw new Error("组合装至少需要 2 个已选组件");
      }
      return {
        files: croppedFiles,
        productMode: "bundle" as const,
        comboLabel: componentBundleLabel,
      };
    }

    return {
      files: originalFiles,
      productMode,
      comboLabel: "",
    };
  };

  const resolveImageStudioInputs = async () => {
    const resolved = await resolveImageStudioSourceFiles();
    return {
      ...resolved,
      payloads: await buildNativeImagePayloadsFromFiles(resolved.files),
    };
  };

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

    const unsubscribe = window.electronAPI?.onImageStudioEvent?.((payload: ImageStudioEventPayloadLike) => {
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

  const handleDetectComponents = async () => {
    if (!imageStudioAPI) return;
    if (!primaryUploadFile || uploadFiles.length !== 1 || !uploadFiles[0]) {
      message.warning("请先上传 1 张包含多个商品/配件的素材图");
      return;
    }

    setDetectingComponents(true);
    try {
      const payloads = await buildNativeImagePayloadsFromFiles([primaryUploadFile]);
      const detection = await imageStudioAPI.detectComponents({ files: payloads });
      const components = normalizeDetectedComponents((detection as ImageStudioComponentDetection)?.components);
      if (components.length === 0) {
        throw new Error("没有识别到可选组件");
      }

      const previewUrl = await readFileAsDataUrl(primaryUploadFile);
      setComponentPreview({
        sourceFileUid: uploadFiles[0].uid,
        sourcePreviewUrl: previewUrl,
        components,
      });
      setSelectedComponentIds([]);
      message.success(`已识别 ${components.length} 个可选组件，勾选后即可按组合装分析`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "组件识别失败");
    } finally {
      setDetectingComponents(false);
    }
  };

  const toggleDetectedComponent = (componentId: number) => {
    setSelectedComponentIds((previous) => (
      previous.includes(componentId)
        ? previous.filter((id) => id !== componentId)
        : [...previous, componentId].sort((left, right) => left - right)
    ));
  };

  const handleAnalyze = async () => {
    if (!imageStudioAPI) return;
    if (uploadFiles.length === 0) {
      message.warning("请先上传商品素材图");
      return;
    }

    setAnalyzing(true);
    try {
      const resolved = await resolveImageStudioInputs();
      const payload = await imageStudioAPI.analyze({ files: resolved.payloads, productMode: resolved.productMode });
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
      const resolved = await resolveImageStudioInputs();
      const payload = await imageStudioAPI.regenerateAnalysis({ files: resolved.payloads, productMode: resolved.productMode, analysis });
      setAnalysis((prev) => normalizeImageStudioAnalysis({
        ...prev,
        ...payload,
        productFacts: payload.productFacts ?? prev.productFacts,
        operatorInsights: payload.operatorInsights
          ? { ...(prev.operatorInsights || {}), ...payload.operatorInsights }
          : prev.operatorInsights,
        creativeDirection: payload.creativeDirection
          ? { ...(prev.creativeDirection || {}), ...payload.creativeDirection }
          : prev.creativeDirection,
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
      const resolved = await resolveImageStudioSourceFiles();
      const nextPlans = await imageStudioAPI.generatePlans({
        analysis,
        imageTypes: selectedImageTypes,
        salesRegion,
        imageSize,
        productMode: resolved.productMode,
      });
      const normalizedPlans = Array.isArray(nextPlans) ? nextPlans : [];
      const clampedPack = Math.max(1, Math.min(12, Math.floor(packCount || 1)));
      const image2Plans = buildLegacyImage2Plans(normalizedPlans, {
        packCount: clampedPack,
        productMode: resolved.productMode,
        referenceImages: buildImage2ReferenceImages(resolved.files, resolved.productMode, resolved.comboLabel),
        salesRegion,
        imageLanguage,
        imageSize,
        productName: normalizeProductDisplayName(analysis.productName) || "Unnamed Product",
        analysis,
      });
      logImage2PlanDiagnostics("generated-plans", image2Plans);
      setPlans(image2Plans);
      return image2Plans;
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
      const resolved = await resolveImageStudioInputs();
      if (!runInBackground) setActiveStep(3);
      // 方案阶段已经生成 image2 电商规格；这里仅兼容历史旧方案或手动粘贴的旧 prompt。
      // 不启用 ShotBrief，不启用后端本地文字合成层，整图仍由 image2 直接生成。
      const clampedPack = Math.max(1, Math.min(12, Math.floor(packCount || 1)));
      const generationPlans = buildLegacyImage2Plans(plans, {
        packCount: clampedPack,
        productMode: resolved.productMode,
        referenceImages: buildImage2ReferenceImages(resolved.files, resolved.productMode, resolved.comboLabel),
        salesRegion,
        imageLanguage,
        imageSize,
        productName: displayProductName,
        analysis,
      });
      logImage2PlanDiagnostics(runInBackground ? "start-generate-background" : "start-generate", generationPlans);
      plansRef.current = generationPlans;
      await imageStudioAPI.startGenerate({
        jobId: nextJobId,
        files: resolved.payloads,
        plans: generationPlans,
        productMode: resolved.productMode,
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
          const restored: UploadFile[] = await Promise.all(sources.files.map(async (s: { name?: string; type?: string; dataUrl: string }, i: number) => {
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
      const currentPlan = plansRef.current.find((plan) => plan.imageType === imageType);
      const score = await imageStudioAPI.scoreImage({
        imageType,
        imageUrl: targetVariant.imageUrl,
        plan: currentPlan,
        analysis,
        productName: displayProductName,
        salesRegion,
        packCount,
      });
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

  const buildProductFactsState = (source: ImageStudioAnalysis) => ({
    productName: source.productFacts?.productName || source.productName || "",
    category: source.productFacts?.category || source.category || "",
    materials: source.productFacts?.materials || source.materials || "",
    colors: source.productFacts?.colors || source.colors || "",
    estimatedDimensions: source.productFacts?.estimatedDimensions || source.estimatedDimensions || "",
    productForm: source.productFacts?.productForm || source.productForm,
    countAndConfiguration: source.productFacts?.countAndConfiguration || "",
    packagingEvidence: source.productFacts?.packagingEvidence || "",
    mountingPlacement: source.productFacts?.mountingPlacement || "",
    factGuardrails: source.productFacts?.factGuardrails || [],
  });

  const buildOperatorInsightsState = (source: ImageStudioAnalysis) => ({
    sellingPoints: source.operatorInsights?.sellingPoints || source.sellingPoints || [],
    targetAudience: source.operatorInsights?.targetAudience || source.targetAudience || [],
    usageScenes: source.operatorInsights?.usageScenes || source.usageScenes || [],
    usageActions: source.operatorInsights?.usageActions || [],
    purchaseDrivers: source.operatorInsights?.purchaseDrivers || [],
    proofPoints: source.operatorInsights?.proofPoints || [],
    buyerQuestions: source.operatorInsights?.buyerQuestions || [],
    riskFlags: source.operatorInsights?.riskFlags || [],
  });

  const updateProductFactsField = (field: ProductFactField, value: string) => {
    setAnalysis((prev) => ({
      ...prev,
      productFacts: {
        ...buildProductFactsState(prev),
        [field]: value,
      },
    }));
  };

  const updateCreativeDirectionField = (field: "pageGoal" | "visualStyle" | "aPlusStory", value: string) => {
    setAnalysis((prev) => ({
      ...prev,
      creativeDirection: {
        ...(prev.creativeDirection || {}),
        creativeBriefs: prev.creativeDirection?.creativeBriefs || prev.creativeBriefs || {},
        suggestedBadges: prev.creativeDirection?.suggestedBadges || prev.suggestedBadges || [],
        imageLayouts: prev.creativeDirection?.imageLayouts || prev.imageLayouts || {},
        [field]: value,
      },
    }));
  };

  const getNestedInsightItems = (field: NestedInsightListField) => {
    if (field === "factGuardrails") return analysis.productFacts?.factGuardrails || [];
    if (field === "purchaseDrivers") return analysis.operatorInsights?.purchaseDrivers || [];
    if (field === "usageActions") return analysis.operatorInsights?.usageActions || [];
    if (field === "proofPoints") return analysis.operatorInsights?.proofPoints || [];
    if (field === "buyerQuestions") return analysis.operatorInsights?.buyerQuestions || [];
    return analysis.operatorInsights?.riskFlags || [];
  };

  const updateNestedInsightItems = (field: NestedInsightListField, items: string[]) => {
    if (field === "factGuardrails") {
      setAnalysis((prev) => ({
        ...prev,
        productFacts: {
          ...buildProductFactsState(prev),
          factGuardrails: items,
        },
      }));
      return;
    }

    setAnalysis((prev) => ({
      ...prev,
      operatorInsights: {
        ...buildOperatorInsightsState(prev),
        [field]: items,
      },
    }));
  };

  const updateAnalysisField = <K extends keyof ImageStudioAnalysis>(field: K, value: ImageStudioAnalysis[K]) => {
    setAnalysis((prev) => {
      const next: ImageStudioAnalysis = { ...prev, [field]: value };
      if (
        field === "productName" ||
        field === "category" ||
        field === "materials" ||
        field === "colors" ||
        field === "estimatedDimensions"
      ) {
        next.productFacts = {
          ...buildProductFactsState(prev),
          [field]: value as string,
        };
      }
      if (field === "sellingPoints" || field === "targetAudience" || field === "usageScenes") {
        next.operatorInsights = {
          ...buildOperatorInsightsState(prev),
          [field]: value as string[],
        };
      }
      return next;
    });
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
    const redrawDraftPlan: ImageStudioPlan = {
      ...basePlan,
      prompt: nextPrompt,
      promptSource: undefined,
      compiledPrompt: undefined,
      shotBrief: undefined,
      title: `${basePlan.title || IMAGE_TYPE_LABELS[imageType] || imageType} \u00b7 \u5019\u9009\u91cd\u7ed8`,
    };
    const nextJobId = `image_redraw_${imageType}_${Date.now()}`;

    try {
      let files: NativeImagePayload[] = [];
      let redrawProductMode = productMode;
      let redrawComboLabel = "";
      let redrawReferenceSources: Array<{ name?: string }> = collectOriginFiles(effectiveFiles);
      if (uploadFiles.length > 0) {
        const resolved = await resolveImageStudioInputs();
        files = resolved.payloads;
        redrawProductMode = resolved.productMode;
        redrawComboLabel = resolved.comboLabel;
        redrawReferenceSources = resolved.files;
      } else {
        files = await buildNativeImagePayloads(effectiveFiles);
      }
      const redrawPlan = buildLegacyImage2Plan(redrawDraftPlan, {
        packCount,
        productMode: redrawProductMode,
        referenceImages: buildImage2ReferenceImages(redrawReferenceSources, redrawProductMode, redrawComboLabel),
        salesRegion,
        imageLanguage,
        imageSize,
        productName: displayProductName,
        analysis,
      });
      logImage2PlanDiagnostics("redraw-generate", [redrawPlan]);

      redrawJobsRef.current = {
        ...redrawJobsRef.current,
        [nextJobId]: {
          imageType,
          suggestion: mode === "guided" ? suggestion : "",
          prompt: redrawPlan.prompt,
        },
      };
      setOpenRedrawComposerFor(null);
      setRedrawingTypes((prev) => ({ ...prev, [imageType]: true }));
      setResults((prev) => ({
        ...prev,
        [imageType]: { ...getResultState(prev, imageType), status: "generating", error: "" },
      }));

      await imageStudioAPI.startGenerate({
        jobId: nextJobId,
        files,
        plans: [redrawPlan],
        productMode: redrawProductMode,
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
  const canChooseProductMode = uploadFiles.length > 1 && !componentBundleActive;
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

  const handleProductModeChange = (nextMode: ImageStudioProductMode) => {
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
          <div className="studio-intake-sticky__desc">
            {componentBundleActive
              ? `已选组合装 ${componentBundleLabel}，开始分析时会按 ${selectedBundleComponents.length} 个组件作为套装处理`
              : intakeStickyHint}
          </div>
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

          {isSingleUploadSource ? (
            <div className="studio-mode-block studio-mode-block--surface" style={{ marginTop: 18 }}>
              <div className="studio-setup-panel__head">
                <div className="studio-setup-panel__eyebrow">组合装识别</div>
                <div className="studio-setup-panel__desc">
                  先识别单张总览图里的各个商品/配件并自动编号，再选择要组成组合装的序号。
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: componentPreviewMatchesUpload ? 16 : 0 }}>
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  onClick={handleDetectComponents}
                  loading={detectingComponents}
                  style={{ borderRadius: 14, border: "none", background: TEMU_BUTTON_GRADIENT, boxShadow: TEMU_BUTTON_SHADOW }}
                >
                  识别并编号
                </Button>
                {componentPreviewMatchesUpload ? (
                  <Button
                    icon={<DeleteOutlined />}
                    onClick={() => clearComponentBundleSelection()}
                    style={{ borderRadius: 14 }}
                  >
                    清空识别
                  </Button>
                ) : null}
                <Text type="secondary" style={{ alignSelf: "center" }}>
                  选择至少 2 个序号时，会自动按组合装走后续分析和生图。
                </Text>
              </div>

              {componentPreviewMatchesUpload && componentPreview ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(280px, 0.85fr)", gap: 18, alignItems: "start" }}>
                  <div
                    style={{
                      position: "relative",
                      borderRadius: 18,
                      overflow: "hidden",
                      border: "1px solid #e7edf3",
                      background: "#fff",
                    }}
                  >
                    <img
                      src={componentPreview.sourcePreviewUrl}
                      alt="组件识别预览"
                      style={{ display: "block", width: "100%", height: "auto" }}
                    />

                    <div
                      style={{
                        borderRadius: 14,
                        border: "1px solid #e6ebf2",
                        background: "#fffaf6",
                        padding: 14,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, color: TEMU_TEXT }}>实际送入分析/生图的裁剪素材</div>
                        {componentBundleActive && preparedComponentBundleMatchesSelection ? (
                          <Tag color="orange" style={{ marginInlineEnd: 0, borderRadius: 999, paddingInline: 10 }}>
                            {preparedComponentBundle?.items.length || 0} 张
                          </Tag>
                        ) : null}
                      </div>

                      {preparingComponentBundle ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 84 }}>
                          <Spin size="small" />
                          <Text type="secondary">正在生成裁剪预览…</Text>
                        </div>
                      ) : componentBundleActive && preparedComponentBundleMatchesSelection && preparedComponentBundle?.items.length ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
                          {preparedComponentBundle.items.map((item) => (
                            <div
                              key={`prepared-component-${item.component.id}`}
                              style={{
                                borderRadius: 12,
                                overflow: "hidden",
                                border: "1px solid #f2d0b3",
                                background: "#fff",
                              }}
                            >
                              <div style={{ aspectRatio: "1 / 1", background: "#fff4ea" }}>
                                <img
                                  src={item.previewUrl}
                                  alt={formatDetectedComponentName(item.component)}
                                  style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                                />
                              </div>
                              <div style={{ padding: "8px 10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                  <span
                                    style={{
                                      width: 22,
                                      height: 22,
                                      borderRadius: 999,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      background: "#ff6a00",
                                      color: "#fff",
                                      fontSize: 12,
                                      fontWeight: 700,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {item.component.id}
                                  </span>
                                  <Text strong style={{ fontSize: 12, color: TEMU_TEXT }}>
                                    {item.file.name}
                                  </Text>
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {formatDetectedComponentName(item.component)}
                                </Text>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Text type="secondary">
                          选择 2 个及以上序号后，这里会直接显示裁剪结果；后续分析和生图会优先使用这些裁剪素材。
                        </Text>
                      )}
                    </div>

                    {componentPreview.components.map((component) => {
                      const selected = selectedComponentIds.includes(component.id);
                      return (
                        <button
                          key={`component-box-${component.id}`}
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleDetectedComponent(component.id);
                          }}
                          style={{
                            position: "absolute",
                            left: `${component.left * 100}%`,
                            top: `${component.top * 100}%`,
                            width: `${component.width * 100}%`,
                            height: `${component.height * 100}%`,
                            borderRadius: 12,
                            border: selected ? "2px solid #ff6a00" : "2px solid rgba(37, 99, 235, 0.9)",
                            background: selected ? "rgba(255,106,0,0.14)" : "rgba(37,99,235,0.08)",
                            boxShadow: selected ? "0 0 0 2px rgba(255,255,255,0.85) inset" : "none",
                            cursor: "pointer",
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              top: 8,
                              left: 8,
                              minWidth: 28,
                              height: 28,
                              padding: "0 8px",
                              borderRadius: 999,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: selected ? "#ff6a00" : "#2563eb",
                              color: "#fff",
                              fontSize: 14,
                              fontWeight: 700,
                              lineHeight: 1,
                            }}
                          >
                            {component.id}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    {componentBundleActive ? (
                      <Alert
                        type="success"
                        showIcon
                        message={`当前组合装：${componentBundleLabel}`}
                        description={`已选 ${selectedBundleComponents.length} 个组件，下一步会按 bundle 模式分析和生图。`}
                        style={{ borderRadius: 14 }}
                      />
                    ) : selectedComponentIds.length === 1 ? (
                      <Alert
                        type="info"
                        showIcon
                        message="已选择 1 个序号"
                        description="再选择至少 1 个序号，就会自动按组合装分析。"
                        style={{ borderRadius: 14 }}
                      />
                    ) : null}

                    {componentPreview.components.map((component) => {
                      const selected = selectedComponentIds.includes(component.id);
                      const name = formatDetectedComponentName(component);
                      return (
                        <button
                          key={`component-item-${component.id}`}
                          type="button"
                          onClick={() => toggleDetectedComponent(component.id)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "12px 14px",
                            borderRadius: 14,
                            border: selected ? "1px solid #ff8c3a" : "1px solid #e6ebf2",
                            background: selected ? "rgba(255,106,0,0.08)" : "#fff",
                            cursor: "pointer",
                            transition: "all .2s ease",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                              <span
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: 999,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  background: selected ? "#ff6a00" : "#eff6ff",
                                  color: selected ? "#fff" : "#2563eb",
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {component.id}
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 600, color: TEMU_TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {name}
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {component.kind === "group" && component.itemCount && component.itemCount > 1
                                    ? `配件组 · ${component.itemCount} 件`
                                    : "单个组件"}
                                </Text>
                              </div>
                            </div>
                            {selected ? <Tag color="orange" style={{ marginInlineEnd: 0 }}>已选</Tag> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

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

  const renderFactField = (
    label: string,
    value: string,
    placeholder: string,
    field: ProductFactField,
  ) => (
    <div>
      <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>{label}</Text>
      <Input
        size="small"
        value={value}
        onChange={(event) => updateProductFactsField(field, event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  const renderNestedListEditor = (
    label: string,
    field: NestedInsightListField,
    placeholder: string,
    tone: "default" | "warn" | "danger" = "default",
  ) => {
    const items = getNestedInsightItems(field);
    const displayItems = items.length > 0 ? items : [""];
    const borderColor = tone === "danger" ? "#ffd6d9" : tone === "warn" ? "#ffe0b2" : "#f0f0f0";
    const headerColor = tone === "danger" ? "#c53030" : tone === "warn" ? "#b7791f" : "#999";

    return (
      <div style={{ background: "#fff", border: `1px solid ${borderColor}`, borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12 }}>
          <Text style={{ fontSize: 12, color: headerColor }}>{label}</Text>
          <Button
            size="small"
            type="text"
            style={{ color: TEMU_ORANGE, paddingInline: 0 }}
            onClick={() => updateNestedInsightItems(field, [...displayItems, ""])}
          >
            {"\u65b0\u589e\u4e00\u6761"}
          </Button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {displayItems.map((item, index) => (
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
                  background: tone === "danger" ? "#fff1f2" : tone === "warn" ? "#fff7e8" : "#fff5ec",
                  color: tone === "danger" ? "#cf1322" : TEMU_ORANGE,
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
                  const nextItems = [...displayItems];
                  nextItems[index] = event.target.value;
                  updateNestedInsightItems(field, nextItems);
                }}
                placeholder={placeholder}
                bordered={false}
                style={{ flex: 1, fontSize: 13 }}
              />
              {displayItems.length > 1 ? (
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => updateNestedInsightItems(field, displayItems.filter((_, itemIndex) => itemIndex !== index))}
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

  const handleTryDesignerAgent = async () => {
    if (!imageStudioAPI) return;
    if (!hasAnalysis) {
      message.warning("请先完成商品分析");
      return;
    }
    setDesignerRunning(true);
    setDesignerDrawerOpen(true);
    try {
      const res = await imageStudioAPI.runDesigner({
        analysis,
        extraNotes: "",
        debug: false,
      });
      setDesignerResult(res as DesignerResult);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "设计师 Agent 调用失败");
      setDesignerResult({
        ok: false,
        sharedDna: null,
        briefs: [],
        auditReport: null,
        reworkRounds: 0,
        warnings: [],
        errors: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      setDesignerRunning(false);
    }
  };

  const renderStepOne = () => (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Card style={{ borderRadius: 16, borderColor: "#ffe0c2", background: "#fffaf5" }} bodyStyle={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 8, minWidth: 260 }}>
            <Title level={4} style={{ margin: 0, color: TEMU_TEXT }}>🧪 设计师工作台（三步）</Title>
            <Space wrap size={6}>
              <Tag color="orange" style={{ borderRadius: 999 }}>1 商品分析</Tag>
              <Tag color="blue" style={{ borderRadius: 999 }}>2 设计 Brief</Tag>
              <Tag color="green" style={{ borderRadius: 999 }}>3 合成真实图</Tag>
            </Space>
          </div>
          <Button
            type="primary"
            onClick={handleTryDesignerAgent}
            loading={designerRunning}
            disabled={!hasAnalysis}
            style={{ borderRadius: 14, background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}
          >
            打开工作台
          </Button>
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "4px 0", flexWrap: "wrap" }}>
        <Button size="small" onClick={() => setActiveStep(0)}>上一步</Button>
        <Space size={8}>
          <Button
            onClick={handleTryDesignerAgent}
            loading={designerRunning}
            disabled={!hasAnalysis}
            style={{ borderRadius: 14 }}
          >
            运行设计师工作台
          </Button>
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
        </Space>
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 16px", marginTop: 14 }}>
          {renderFactField("件数 / 组合", analysis.productFacts?.countAndConfiguration || "", "例如：单件 / 2件套 / 组合装", "countAndConfiguration")}
          {renderFactField("安装 / 摆放", analysis.productFacts?.mountingPlacement || "", "例如：挂墙 / 桌面 / 手持", "mountingPlacement")}
          {renderFactField("包装依据", analysis.productFacts?.packagingEvidence || "", "例如：可见真实包装 / 仅能用中性包装", "packagingEvidence")}
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

      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 8, padding: "16px 20px" }}>
        <Text strong style={{ fontSize: 15, color: "#333", display: "block", marginBottom: 12 }}>事实护栏</Text>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          {renderNestedListEditor("不可违背的商品事实", "factGuardrails", "例如：20cm 小挂镜，不能画成大墙镜", "warn")}
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 8, padding: "16px 20px" }}>
        <Text strong style={{ fontSize: 15, color: "#333", display: "block", marginBottom: 12 }}>运营判断</Text>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 14 }}>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>页面目标</Text>
            <Input
              size="small"
              value={analysis.creativeDirection?.pageGoal || ""}
              onChange={(event) => updateCreativeDirectionField("pageGoal", event.target.value)}
              placeholder="例如：先建立真实感，再放大礼品感"
            />
          </div>
          <div>
            <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>视觉方向</Text>
            <Input
              size="small"
              value={analysis.creativeDirection?.visualStyle || ""}
              onChange={(event) => updateCreativeDirectionField("visualStyle", event.target.value)}
              placeholder="例如：暗黑复古，但必须保留真实尺寸比例"
            />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 12, color: "#999", display: "block", marginBottom: 4 }}>A+ 故事线</Text>
          <Input
            size="small"
            value={analysis.creativeDirection?.aPlusStory || ""}
            onChange={(event) => updateCreativeDirectionField("aPlusStory", event.target.value)}
            placeholder="例如：先证明真实使用，再解释细节，最后强化信任和购买理由"
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          {renderNestedListEditor("购买驱动", "purchaseDrivers", "例如：礼品属性强 / 小空间友好 / 风格识别度高")}
          {renderNestedListEditor("使用动作", "usageActions", "例如：手持涂抹 / 挂墙安装 / 打开收纳 / 佩戴展示")}
          {renderNestedListEditor("证明点", "proofPoints", "例如：材质纹理 / 容量大小 / 修复前后 / 包装内容")}
          {renderNestedListEditor("买家疑虑", "buyerQuestions", "例如：会不会太小 / 怎么安装 / 有没有包装")}
          {renderNestedListEditor("风险提示", "riskFlags", "例如：禁止把挂墙镜画成立放摆件", "danger")}
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
            <Space size={8} wrap>
              <Title level={4} style={{ margin: 0, color: TEMU_TEXT }}>图片生成方案</Title>
              <Tag color="blue">gpt-image-2</Tag>
            </Space>
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
                        <Space size={6} wrap>
                          <Text strong style={{ color: TEMU_TEXT }}>{IMAGE_TYPE_LABELS[plan.imageType] || plan.imageType}</Text>
                          {isDesignerEnhancedPlan(plan) ? <Tag color="orange">GPT 设计师</Tag> : null}
                          {plan.promptSource === SHOT_BRIEF_PROMPT_SOURCE ? <Tag color="blue">ShotBrief</Tag> : null}
                          {plan.shotBrief?.categoryStrategy ? (
                            <Tag color="geekblue">{formatStrategyNameForPreview(plan.shotBrief.categoryStrategy)}</Tag>
                          ) : null}
                          {plan.shotBrief?.mainImageStrategy ? (
                            <Tag color="green">{formatStrategyNameForPreview(plan.shotBrief.mainImageStrategy.strategyName)}</Tag>
                          ) : null}
                        </Space>
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

      <Drawer
        title="🧪 设计师工作台（三步）"
        placement="right"
        width={1080}
        open={designerDrawerOpen}
        onClose={() => setDesignerDrawerOpen(false)}
        destroyOnClose={false}
      >
        {designerRunning && !designerResult ? (
          <Space direction="vertical" size={16} align="center" style={{ width: "100%", padding: 40 }}>
            <Spin size="large" />
            <Text type="secondary">设计师工作台运行中，5 stage 串行 + 10 张图并行，首轮约需 1-2 分钟…</Text>
          </Space>
        ) : designerResult ? (
          <DesignerSummary result={designerResult} primaryUploadFile={primaryUploadFile} />
        ) : (
          <Empty description="尚未执行" />
        )}
      </Drawer>
    </div>
  );
}
