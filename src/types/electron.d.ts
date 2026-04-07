import type {
  ImageStudioAnalysis,
  ImageStudioConfig,
  ImageStudioGeneratedImage,
  ImageStudioHistoryItem,
  ImageStudioHistorySummary,
  ImageStudioImageScore,
  ImageStudioPlan,
  ImageStudioStatus,
  NativeImagePayload,
} from "../utils/imageStudio";

interface AutomationAPI {
  login: (accountId: string, phone: string, password: string) => Promise<{ success: boolean; matchedStoreName?: string }>;
  scrapeProducts: () => Promise<any>;
  scrapeOrders: () => Promise<any>;
  scrapeSales: () => Promise<any>;
  scrapeFlux: () => Promise<any>;
  scrapeDashboard: () => Promise<any>;
  scrapeAfterSales: () => Promise<any>;
  scrapeSoldOut: () => Promise<any>;
  scrapeGoodsData: () => Promise<any>;
  scrapeActivity: () => Promise<any>;
  scrapePerformance: () => Promise<any>;
  scrapeAll: () => Promise<any>;
  readScrapeData: (key: string) => Promise<any>;
  scrapeLifecycle: () => Promise<any>;
  scrapeBidding: () => Promise<any>;
  scrapePriceCompete: () => Promise<any>;
  scrapeHotPlan: () => Promise<any>;
  scrapeCheckup: () => Promise<any>;
  scrapeUSRetrieval: () => Promise<any>;
  scrapeDelivery: () => Promise<any>;
  scrapeGlobalPerformance: (range?: "1d" | "7d" | "30d") => Promise<any>;
  scrapeSkcRegionDetail: (productId: number | string, range?: "1d" | "7d" | "30d") => Promise<any>;
  yunduListOverall: (params?: { pageNo?: number; pageSize?: number; isLack?: boolean }) => Promise<any>;
  yunduSiteCount: (params?: { skcIds?: number[] }) => Promise<any>;
  yunduHighPriceLimit: (params?: { skcIds?: number[] }) => Promise<any>;
  yunduQualityMetrics: (params?: { pageNum?: number; pageSize?: number }) => Promise<any>;
  yunduActivityList: (params?: { pageNum?: number; pageSize?: number }) => Promise<any>;
  yunduActivityEnrolled: (params?: { pageNum?: number; pageSize?: number }) => Promise<any>;
  yunduActivityMatch: (params: { activityThematicId: number; activityType?: number; productIds?: number[]; productSkcExtCodes?: string[]; rowCount?: number; hasMore?: boolean }) => Promise<any>;
  yunduActivitySubmit: (params: { activityThematicId: number; productIds: number[]; extra?: any }) => Promise<any>;
  yunduAutoEnroll: (params: { activityThematicId: number; activityType?: number; dryRun?: boolean }) => Promise<any>;
  autoPricing: (params: any) => Promise<any>;
  startAutoPricing: (params: any) => Promise<any>;
  getProgress: () => Promise<any>;
  getTaskProgress: (taskId?: string) => Promise<any>;
  listTasks: () => Promise<any>;
  pausePricing: (taskId?: string) => Promise<any>;
  resumePricing: (taskId?: string) => Promise<any>;
  getScrapeProgress: () => Promise<any>;
  listDrafts: () => Promise<any>;
  retryDraft: (draftId: string) => Promise<any>;
  deleteDraft: (draftId: string) => Promise<any>;
  filterProductTable: (csvPath: string) => Promise<any>;
  close: () => Promise<{ status: string }>;
  ping: () => Promise<{ status: string }>;
}

interface ImageStudioGenerateStarted {
  jobId: string;
}

interface ImageStudioGenerateRuntimeEvent {
  imageType?: string;
  status?: string;
  imageUrl?: string;
  error?: string;
  warnings?: string[];
}

interface ImageStudioEventPayload {
  jobId: string;
  type: "generate:started" | "generate:event" | "generate:complete" | "generate:error" | "generate:cancelled";
  event?: ImageStudioGenerateRuntimeEvent;
  results?: ImageStudioGeneratedImage[];
  error?: string;
  message?: string;
  historySaved?: boolean;
  historyId?: string | null;
  historySaveError?: string | null;
}

interface ImageStudioJob {
  jobId: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  productName: string;
  salesRegion?: string;
  runInBackground?: boolean;
  imageTypes: string[];
  results: ImageStudioGeneratedImage[];
  progress: { done: number; total: number; step: string };
  createdAt: number;
  finishedAt: number | null;
  error: string | null;
  historySaved?: boolean;
  historyId?: string | null;
  historySaveError?: string | null;
}

interface ImageStudioAPI {
  getStatus: () => Promise<ImageStudioStatus>;
  ensureRunning: () => Promise<ImageStudioStatus>;
  restart: () => Promise<ImageStudioStatus>;
  getConfig: () => Promise<ImageStudioConfig>;
  updateConfig: (payload: Partial<ImageStudioConfig>) => Promise<ImageStudioConfig>;
  openExternal: () => Promise<string>;
  analyze: (payload: { files: NativeImagePayload[]; productMode: string }) => Promise<ImageStudioAnalysis>;
  regenerateAnalysis: (payload: { files: NativeImagePayload[]; productMode: string; analysis: ImageStudioAnalysis }) => Promise<Pick<ImageStudioAnalysis, "sellingPoints" | "targetAudience" | "usageScenes">>;
  generatePlans: (payload: { analysis: ImageStudioAnalysis; imageTypes: string[]; salesRegion: string; imageSize: string; productMode: string }) => Promise<ImageStudioPlan[]>;
  startGenerate: (payload: { jobId?: string; files: NativeImagePayload[]; plans: ImageStudioPlan[]; productMode: string; salesRegion?: string; runInBackground?: boolean; imageLanguage: string; imageSize: string; productName?: string }) => Promise<ImageStudioGenerateStarted>;
  cancelGenerate: (jobId: string) => Promise<{ cancelled: boolean; jobId: string }>;
  listHistory: () => Promise<ImageStudioHistorySummary[]>;
  getHistoryItem: (id: string) => Promise<ImageStudioHistoryItem | null>;
  saveHistory: (payload: { productName: string; salesRegion: string; imageCount: number; images: ImageStudioGeneratedImage[] }) => Promise<{ id: string }>;
  scoreImage: (payload: { imageUrl: string; imageType: string }) => Promise<ImageStudioImageScore>;
  listJobs: () => Promise<ImageStudioJob[]>;
  getJob: (jobId: string) => Promise<ImageStudioJob | null>;
  clearJob: (jobId: string) => Promise<void>;
  downloadAll: (payload: { images: ImageStudioGeneratedImage[]; productName?: string }) => Promise<{ saved?: number; total?: number; dir?: string; cancelled?: boolean }>;
}

interface AppAPI {
  getVersion: () => Promise<string>;
  getUpdateStatus: () => Promise<any>;
  checkForUpdates: () => Promise<any>;
  downloadUpdate: () => Promise<any>;
  quitAndInstallUpdate: () => Promise<boolean>;
  openLogDirectory: () => Promise<string>;
}

interface StoreAPI {
  get: (key: string) => Promise<any>;
  set: (key: string, data: any) => Promise<boolean>;
}

interface ElectronAPI {
  getAppPath: () => Promise<string>;
  selectFile: (filters?: any) => Promise<string | null>;
  automation: AutomationAPI;
  imageStudio: ImageStudioAPI;
  app: AppAPI;
  store: StoreAPI;
  onAutomationEvent: (callback: (data: any) => void) => (() => void);
  onUpdateStatus?: (callback: (data: any) => void) => (() => void);
  onImageStudioEvent?: (callback: (data: ImageStudioEventPayload) => void) => (() => void);
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
