import {
  isCompleteCollectionDiagnostics,
  type CollectionDiagnostics,
} from "./collectionDiagnostics";

export const TOOL_COLLECTION_GUARD_HOUR = 9;

export const TOOL_COLLECTION_REQUIRED_PATHS = new Set<string>([
  "/create-product",
  "/image-studio",
  "/image-studio-gpt",
  "/price-review",
]);

export interface ToolCollectionRequirementState {
  active: boolean;
  allowed: boolean;
  reason: string | null;
  lastCollectionAt: Date | null;
  lastCollectionLabel: string | null;
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseCollectionTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct;

  const fallback = trimmed
    .replace(/年/g, "/")
    .replace(/月/g, "/")
    .replace(/日/g, " ")
    .replace(/上午/g, "AM ")
    .replace(/下午/g, "PM ");

  const parsed = new Date(fallback);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCollectionTimestamp(value: string | null | undefined) {
  const parsed = parseCollectionTimestamp(value);
  if (!parsed) return null;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function getLastCollectionTimestamp(diagnostics: CollectionDiagnostics | null) {
  if (!diagnostics) return null;
  const fullCollectionTimestamp = diagnostics.fullSyncedAtIso || diagnostics.fullSyncedAt;
  if (fullCollectionTimestamp) {
    return parseCollectionTimestamp(fullCollectionTimestamp);
  }

  if (isCompleteCollectionDiagnostics(diagnostics)) {
    return parseCollectionTimestamp(diagnostics.syncedAtIso || diagnostics.syncedAt);
  }

  return null;
}

export function isToolCollectionRoute(pathname: string) {
  const normalized = pathname.startsWith("/products/") ? "/products" : pathname;
  return TOOL_COLLECTION_REQUIRED_PATHS.has(normalized);
}

export function getToolCollectionRequirementState(
  diagnostics: CollectionDiagnostics | null,
  now = new Date(),
): ToolCollectionRequirementState {
  const active = now.getHours() >= TOOL_COLLECTION_GUARD_HOUR;
  const lastCollectionAt = getLastCollectionTimestamp(diagnostics);
  const lastCollectionLabel = formatCollectionTimestamp(
    diagnostics?.fullSyncedAtIso
      || diagnostics?.fullSyncedAt
      || (isCompleteCollectionDiagnostics(diagnostics) ? diagnostics?.syncedAtIso || diagnostics?.syncedAt : null),
  );

  if (!active) {
    return {
      active: false,
      allowed: true,
      reason: null,
      lastCollectionAt,
      lastCollectionLabel,
    };
  }

  if (!diagnostics) {
    return {
      active: true,
      allowed: false,
      reason: "今天 9:00 后还没有完成完整店铺采集，请先去“数据采集”页执行一遍。",
      lastCollectionAt,
      lastCollectionLabel,
    };
  }

  if (!isCompleteCollectionDiagnostics(diagnostics)) {
    return {
      active: true,
      allowed: false,
      reason: "当前只有部分采集结果，工具需要今天 9:00 后完整采集一次。",
      lastCollectionAt,
      lastCollectionLabel,
    };
  }

  if (!lastCollectionAt) {
    return {
      active: true,
      allowed: false,
      reason: "采集时间无法识别，请重新完整采集一次。",
      lastCollectionAt,
      lastCollectionLabel,
    };
  }

  if (localDateKey(lastCollectionAt) !== localDateKey(now)) {
    return {
      active: true,
      allowed: false,
      reason: "今天 9:00 后还没有完成完整店铺采集，请先去“数据采集”页执行一遍。",
      lastCollectionAt,
      lastCollectionLabel,
    };
  }

  if (lastCollectionAt.getHours() < TOOL_COLLECTION_GUARD_HOUR) {
    return {
      active: true,
      allowed: false,
      reason: "今天的采集发生在 9:00 之前，9:00 之后还需要再采集一遍才能使用工具。",
      lastCollectionAt,
      lastCollectionLabel,
    };
  }

  return {
    active: true,
    allowed: true,
    reason: null,
    lastCollectionAt,
    lastCollectionLabel,
  };
}
