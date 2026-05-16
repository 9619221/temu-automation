export const APP_SETTINGS_KEY = "temu_app_settings";

export interface AppSettings {
  operationDelay: number;
  maxRetries: number;
  headless: boolean;
  autoLoginRetry: boolean;
  lowStockThreshold: number;
  screenshotOnError: boolean;
  updateFeedUrl: string;
  updateProxyRules: string;
  // 核价筛选器
  priceReviewAutoScanEnabled: boolean;       // 是否每 30 分钟自动扫核价页
  priceReviewScanIntervalMinutes: number;    // 扫描间隔（分钟），默认 30
  priceReviewMarginRatio: number;            // 毛利倍率，默认 1.75
  priceReview1688ProfilePath: string;        // 1688 图搜专用 Chrome user-data-dir
  autoImageSwapRootDir: string;              // 批量替换图片：本地图片根目录（子文件夹按 SPU/SKC 命名）
  extensionPackageUrl: string;               // 浏览器扩展 ZIP/压缩包下载链接
  extensionInstallUrl: string;                // Chrome Web Store 扩展安装链接
}

const LEGACY_UPDATE_FEED_URLS = new Set([
  "http://127.0.0.1:8765/releases/",
  "http://192.168.1.2:8765/releases/",
]);

function isGithubReleasePageUrl(value: string): boolean {
  return /^https?:\/\/github\.com\/[^/]+\/[^/]+\/releases(?:\/.*)?$/i.test(value);
}

function normalizeUpdateFeedUrl(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_APP_SETTINGS.updateFeedUrl;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_APP_SETTINGS.updateFeedUrl;
  const normalized = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  if (LEGACY_UPDATE_FEED_URLS.has(normalized)) {
    return DEFAULT_APP_SETTINGS.updateFeedUrl;
  }
  if (isGithubReleasePageUrl(trimmed)) {
    return DEFAULT_APP_SETTINGS.updateFeedUrl;
  }
  return normalized;
}

function normalizeStringSetting(raw: unknown, fallback = ""): string {
  return typeof raw === "string" ? raw.trim() : fallback;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  operationDelay: 1500,
  maxRetries: 3,
  headless: false,
  autoLoginRetry: true,
  lowStockThreshold: 10,
  screenshotOnError: true,
  updateFeedUrl: "",
  updateProxyRules: "",
  priceReviewAutoScanEnabled: false,
  priceReviewScanIntervalMinutes: 30,
  priceReviewMarginRatio: 1.75,
  priceReview1688ProfilePath: "",
  autoImageSwapRootDir: "",
  extensionPackageUrl: "",
  extensionInstallUrl: "",
};

export function normalizeAppSettings(raw: unknown): AppSettings {
  const data = (raw && typeof raw === "object") ? raw as Partial<AppSettings> : {};

  return {
    operationDelay: typeof data.operationDelay === "number" ? data.operationDelay : DEFAULT_APP_SETTINGS.operationDelay,
    maxRetries: typeof data.maxRetries === "number" ? data.maxRetries : DEFAULT_APP_SETTINGS.maxRetries,
    headless: typeof data.headless === "boolean" ? data.headless : DEFAULT_APP_SETTINGS.headless,
    autoLoginRetry: typeof data.autoLoginRetry === "boolean" ? data.autoLoginRetry : DEFAULT_APP_SETTINGS.autoLoginRetry,
    lowStockThreshold: typeof data.lowStockThreshold === "number" ? data.lowStockThreshold : DEFAULT_APP_SETTINGS.lowStockThreshold,
    screenshotOnError: typeof data.screenshotOnError === "boolean" ? data.screenshotOnError : DEFAULT_APP_SETTINGS.screenshotOnError,
    updateFeedUrl: normalizeUpdateFeedUrl(data.updateFeedUrl),
    updateProxyRules: normalizeStringSetting(data.updateProxyRules),
    priceReviewAutoScanEnabled: typeof data.priceReviewAutoScanEnabled === "boolean"
      ? data.priceReviewAutoScanEnabled
      : DEFAULT_APP_SETTINGS.priceReviewAutoScanEnabled,
    priceReviewScanIntervalMinutes: typeof data.priceReviewScanIntervalMinutes === "number" && data.priceReviewScanIntervalMinutes >= 5
      ? data.priceReviewScanIntervalMinutes
      : DEFAULT_APP_SETTINGS.priceReviewScanIntervalMinutes,
    priceReviewMarginRatio: typeof data.priceReviewMarginRatio === "number" && data.priceReviewMarginRatio > 1
      ? data.priceReviewMarginRatio
      : DEFAULT_APP_SETTINGS.priceReviewMarginRatio,
    priceReview1688ProfilePath: typeof data.priceReview1688ProfilePath === "string"
      ? data.priceReview1688ProfilePath
      : DEFAULT_APP_SETTINGS.priceReview1688ProfilePath,
    autoImageSwapRootDir: typeof data.autoImageSwapRootDir === "string"
      ? data.autoImageSwapRootDir
      : DEFAULT_APP_SETTINGS.autoImageSwapRootDir,
    extensionPackageUrl: typeof data.extensionPackageUrl === "string"
      ? data.extensionPackageUrl
      : DEFAULT_APP_SETTINGS.extensionPackageUrl,
    extensionInstallUrl: typeof data.extensionInstallUrl === "string"
      ? data.extensionInstallUrl
      : DEFAULT_APP_SETTINGS.extensionInstallUrl,
  };
}
