import type {
  ImageStudioAnalysis,
  ImageStudioComponentDetection,
  ImageStudioConfig,
  ImageStudioGeneratedImage,
  ImageStudioHistoryItem,
  ImageStudioHistorySummary,
  ImageStudioImageScore,
  ImageStudioPlan,
  ImageStudioStatus,
  NativeImagePayload,
} from "../utils/imageStudio";
import type { DesignBrief, DesignerResult, SharedDNA } from "../components/designer";

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
  scrapeFluxProductDetail: (params: {
    siteLabel?: string;
    goodsId?: number | string;
    spuId?: number | string;
    skcId?: number | string;
    skuId?: number | string;
    title?: string;
    rangeLabel?: string;
  }) => Promise<any>;
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
  generatePackImages: (params: any) => Promise<any>;
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

interface DesignerOpsBrief {
  productName: string;
  productDescription: string;
  howToUse: string;
  sellingPoints: string[];
  targetAudience: {
    buyer: string;
    user: string;
  };
  painPointsAndNeeds: string[];
  imageStyle: string;
}

interface DesignerTextOverlay {
  headline?: string;
  subhead?: string;
  pillLabels?: string[];
}

interface DesignerImagePrompt {
  slot: number;
  imageType: string;
  mode: "edit" | "generate";
  cameraAngle: string;
  sceneDescription: string;
  mood: string;
  prompt: string;
  textOverlay: DesignerTextOverlay | null;
}

interface DesignerPlanResponse {
  ok?: boolean;
  productIdentity?: string;
  globalForbidden?: string[];
  imagePrompts?: DesignerImagePrompt[];
  warnings?: string[];
  errors?: string[];
  elapsedMs?: number;
  error?: string;
}

interface DesignerGenerateEventPayload {
  jobId: string;
  type: "started" | "event" | "done" | "cancelled" | "error";
  event?: {
    slot?: number;
    status?: string;
    dataUrl?: string;
    error?: string;
    bytes?: number;
  };
  error?: string;
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

interface ImageStudioComposedImage {
  slot: number;
  method: string;
  dataUrl: string;
  bytes: number;
}

interface ImageStudioAPI {
  switchProfile?: () => Promise<{ profile: string; status: unknown }>;
  getStatus: () => Promise<ImageStudioStatus>;
  ensureRunning: () => Promise<ImageStudioStatus>;
  restart: () => Promise<ImageStudioStatus>;
  getConfig: () => Promise<ImageStudioConfig>;
  updateConfig: (payload: Partial<ImageStudioConfig>) => Promise<ImageStudioConfig>;
  openExternal: () => Promise<string>;
  detectComponents: (payload: { files: NativeImagePayload[] }) => Promise<ImageStudioComponentDetection>;
  analyze: (payload: { files: NativeImagePayload[]; productMode: string }) => Promise<ImageStudioAnalysis>;
  regenerateAnalysis: (
    payload: { files: NativeImagePayload[]; productMode: string; analysis: ImageStudioAnalysis }
  ) => Promise<Partial<ImageStudioAnalysis>>;
  translate: (payload: { texts: string[] }) => Promise<{ translations: string[] }>;
  generatePlans: (payload: { analysis: ImageStudioAnalysis; imageTypes: string[]; salesRegion: string; imageSize: string; productMode: string }) => Promise<ImageStudioPlan[]>;
  startGenerate: (payload: { jobId?: string; files: NativeImagePayload[]; plans: ImageStudioPlan[]; productMode: string; salesRegion?: string; runInBackground?: boolean; imageLanguage: string; imageSize: string; productName?: string }) => Promise<ImageStudioGenerateStarted>;
  cancelGenerate: (jobId: string) => Promise<{ cancelled: boolean; jobId: string }>;
  listHistory: () => Promise<ImageStudioHistorySummary[]>;
  getHistoryItem: (id: string) => Promise<ImageStudioHistoryItem | null>;
  getHistorySources: (id: string) => Promise<{ files: Array<{ name: string; type: string; dataUrl: string }>; error?: string }>;
  saveHistory: (payload: { productName: string; salesRegion: string; imageCount: number; images: ImageStudioGeneratedImage[] }) => Promise<{ id: string }>;
  scoreImage: (payload: {
    imageUrl: string;
    imageType: string;
    plan?: ImageStudioPlan;
    analysis?: ImageStudioAnalysis;
    productName?: string;
    salesRegion?: string;
    packCount?: number;
  }) => Promise<ImageStudioImageScore>;
  listJobs: () => Promise<ImageStudioJob[]>;
  getJob: (jobId: string) => Promise<ImageStudioJob | null>;
  clearJob: (jobId: string) => Promise<void>;
  downloadAll: (payload: { images: ImageStudioGeneratedImage[]; productName?: string }) => Promise<{ saved?: number; total?: number; dir?: string; cancelled?: boolean }>;
  runDesigner: (payload: { analysis: ImageStudioAnalysis; extraNotes?: string; debug?: boolean }) => Promise<DesignerResult>;
  composeBriefs: (payload: {
    briefs: DesignBrief[];
    sharedDna: SharedDNA | null;
    productImageBase64?: string | null;
  }) => Promise<{ images?: ImageStudioComposedImage[]; error?: string }>;
  composeImagePrompts?: (payload: { imagePrompts: DesignerImagePrompt[]; productIdentity: string; productImageBase64?: string | null }) => Promise<unknown>;
  regenerateSlot?: (payload: { imagePrompt: DesignerImagePrompt; productIdentity: string; productImageBase64?: string | null; promptOverride?: string | null }) => Promise<unknown>;
  designerAnalyze?: (payload: { productImageBase64: string; productInput?: unknown }) => Promise<{ ok?: boolean; opsBrief?: DesignerOpsBrief; elapsedMs?: number; error?: string }>;
  designerPlan?: (payload: { opsBrief: DesignerOpsBrief; productImageBase64: string; debug?: boolean }) => Promise<DesignerPlanResponse>;
  designerGenerateStart?: (payload: { jobId?: string; imagePrompts: DesignerImagePrompt[]; productIdentity: string; productImageBase64?: string | null }) => Promise<{ jobId: string }>;
  designerGenerateCancel?: (jobId: string) => Promise<{ cancelled: boolean; jobId: string }>;
  onDesignerGenerateEvent?: (handler: (payload: DesignerGenerateEventPayload) => void) => (() => void);
}

interface AppAPI {
  getVersion: () => Promise<string>;
  getUpdateStatus: () => Promise<any>;
  checkForUpdates: () => Promise<any>;
  downloadUpdate: () => Promise<any>;
  quitAndInstallUpdate: () => Promise<boolean>;
  openLogDirectory: () => Promise<string>;
  readWorkflowPackLogs?: (params?: { limit?: number }) => Promise<{ logFile?: string; entries?: any[] }>;
  clearWorkflowPackLogs?: () => Promise<{ logFile?: string; cleared?: boolean }>;
}

interface StoreAPI {
  get: (key: string) => Promise<any>;
  getMany: (keys: string[]) => Promise<Record<string, any>>;
  set: (key: string, data: any) => Promise<boolean>;
  setMany: (entries: Record<string, any>) => Promise<boolean>;
}

interface ErpStatus {
  initialized: boolean;
  dbPath: string | null;
  backupPath?: string | null;
  migrations: Array<{ key: string; status: "success" | "skipped" | "failed" | string }>;
  error?: { name?: string; code?: string | null; message: string } | null;
}

interface ErpActor {
  id?: string | null;
  role: string;
}

interface ErpUserSession {
  id: string;
  name: string;
  role: string;
  status: string;
}

interface ErpAuthStatus {
  hasUsers: boolean;
  currentUser: ErpUserSession | null;
}

interface ErpListParams {
  accountId?: string;
  limit?: number;
  offset?: number;
}

interface ErpWorkflowTransitionPayload {
  entityType: string;
  id: string;
  action: string;
  toStatus: string;
  actor: ErpActor;
  patch?: Record<string, any>;
}

interface ErpWorkflowCanTransitionPayload {
  entityType: string;
  fromStatus: string;
  toStatus: string;
  action: string;
  role: string;
}

interface ErpLanStatus {
  running: boolean;
  port: number;
  bindAddress: string;
  startedAt: string | null;
  localUrl: string;
  primaryUrl: string;
  lanUrls: string[];
  routes: Array<{ path: string; label: string; allowedRoles?: string[] }>;
  authMode: string;
  sessionCount?: number;
  lastError?: string | null;
}

interface ErpAPI {
  getStatus: () => Promise<ErpStatus>;
  runMigrations: () => Promise<ErpStatus>;
  getEnums: () => Promise<Record<string, Record<string, string>>>;
  auth: {
    getStatus: () => Promise<ErpAuthStatus>;
    getCurrentUser: () => Promise<ErpUserSession | null>;
    createFirstAdmin: (payload: { name: string; accessCode: string }) => Promise<ErpAuthStatus>;
    login: (payload: { login: string; accessCode: string }) => Promise<ErpAuthStatus>;
    logout: () => Promise<ErpAuthStatus>;
  };
  account: {
    list: (params?: ErpListParams) => Promise<any[]>;
    upsert: (payload: {
      id?: string;
      name: string;
      phone?: string;
      status?: string;
      source?: string;
    }) => Promise<any>;
  };
  user: {
    list: (params?: ErpListParams) => Promise<any[]>;
    upsert: (payload: {
      id?: string;
      name: string;
      role: string;
      status?: string;
      accessCode?: string;
    }) => Promise<any>;
  };
  supplier: {
    list: (params?: ErpListParams) => Promise<any[]>;
    create: (payload: {
      id?: string;
      name: string;
      contactName?: string;
      phone?: string;
      wechat?: string;
      address?: string;
      categories?: string[];
      status?: string;
    }) => Promise<any>;
  };
  sku: {
    list: (params?: ErpListParams) => Promise<any[]>;
    create: (payload: {
      id?: string;
      accountId: string;
      internalSkuCode: string;
      productName: string;
      temuSkuId?: string;
      temuProductId?: string;
      temuSkcId?: string;
      category?: string;
      imageUrl?: string;
      supplierId?: string;
      status?: string;
    }) => Promise<any>;
  };
  purchase: {
    workbench: (params?: ErpListParams) => Promise<any>;
    action: (payload: Record<string, any>) => Promise<any>;
  };
  warehouse: {
    workbench: (params?: ErpListParams) => Promise<any>;
    action: (payload: Record<string, any>) => Promise<any>;
  };
  workflow: {
    canTransition: (payload: ErpWorkflowCanTransitionPayload) => Promise<boolean>;
    transition: (payload: ErpWorkflowTransitionPayload) => Promise<any>;
  };
  qc: {
    workbench: (params?: ErpListParams) => Promise<any>;
    action: (payload: Record<string, any>) => Promise<any>;
    decide: (payload: {
      actualSampleQty: number;
      defectiveQty: number;
      observationThreshold?: number;
      failureThreshold?: number;
    }) => Promise<any>;
  };
  outbound: {
    workbench: (params?: ErpListParams) => Promise<any>;
    action: (payload: Record<string, any>) => Promise<any>;
  };
  workItem: {
    list: (params?: ErpListParams & {
      ownerRole?: string;
      status?: string;
      priority?: string;
      activeOnly?: boolean;
    }) => Promise<any[]>;
    stats: (params?: ErpListParams) => Promise<any>;
    generate: (payload?: ErpListParams & { actor?: ErpActor }) => Promise<any>;
    updateStatus: (payload: {
      id?: string;
      workItemId?: string;
      status: string;
      remark?: string;
      actor?: ErpActor;
    }) => Promise<any>;
  };
  lan: {
    getStatus: () => Promise<ErpLanStatus>;
    start: (payload?: { port?: number; bindAddress?: string }) => Promise<ErpLanStatus>;
    stop: () => Promise<ErpLanStatus>;
  };
}

interface YunqiPriceEntry {
  date?: string;
  region?: string;
  price?: number;
  currency?: string;
  marketPrice?: number | null;
}

interface YunqiDailySalesPoint {
  date?: string;
  sales?: number;
}

interface YunqiProductFields {
  title: string;
  price: number;
  priceText: string;
  imageUrl?: string;
  imageUrls?: string[];
  originalPrice?: number;
  score?: number;
  rating?: number;
  reviewCount?: number;
  salesText?: string;
  dailySales?: number;
  weeklySales?: number;
  monthlySales?: number;
  totalWeeklySales?: number;
  totalMonthlySales?: number;
  weeklySalesPercentage?: number;
  monthlySalesPercentage?: number;
  totalSales?: number;
  dailySalesList?: YunqiDailySalesPoint[];
  currency?: string;
  marketPrice?: number | null;
  usdPrice?: number | null;
  eurPrice?: number | null;
  prices?: YunqiPriceEntry[];
  priceList?: any[];
  usdGmv?: number;
  eurGmv?: number;
  images: string[];
  videoUrl?: string;
  goodsId?: string;
  skuId?: string;
  category?: string;
  categoryName?: string;
  titleEn?: string;
  titleZh?: string;
  originalTitle?: string;
  commentNumTips?: string;
  mall?: string;
  mallName?: string;
  mallId?: string;
  mallScore?: number | null;
  mallTotalGoods?: number | null;
  brand?: string;
  region?: string;
  optId?: string | number;
  optIds?: Array<string | number>;
  labels?: any[];
  tags?: any[];
  customTags?: any[];
  tagIds?: Array<string | number>;
  wareHouseType?: number;
  activityType?: string;
  createdAt?: string;
  issuedDate?: string;
  lastModified?: string;
  soldOut?: boolean;
  lastSoldOutAt?: string;
  sameNum?: number;
  adRecords?: any[];
  lastAdTime?: string;
  adult?: boolean;
  url?: string;
  scrapedAt?: string;
  raw?: Record<string, any>;
}

interface CompetitorSearchResult extends YunqiProductFields {
  imageUrl: string;
  productUrl: string;
  position: number;
}

interface CompetitorProductSnapshot extends YunqiProductFields {
  url: string;
  scrapedAt: string;
  matchStatus?: "exact" | "not_matched";
  requestedGoodsId?: string;
  candidates?: Array<{ goodsId: string; title: string }>;
  screenshot?: string;
  error?: string | null;
}

interface CompetitorSearchResponse {
  products: CompetitorSearchResult[];
  keyword: string;
  region: string;
  totalFound: number;
  scrapedAt: string;
  screenshot?: string;
}

interface CompetitorBatchTrackResponse {
  results: (CompetitorProductSnapshot & { url: string })[];
  total: number;
  success: number;
  scrapedAt: string;
}

interface CompetitorAutoRegisterResult {
  success: boolean;
  email: string;
  region: string;
  registeredAt: string;
  message: string;
}

interface CompetitorAPI {
  search: (params: { keyword: string; maxResults?: number; region?: string; wareHouseType?: number }) => Promise<CompetitorSearchResponse>;
  track: (params: { url?: string; goodsId?: string; wareHouseType?: number; allowNotMatched?: boolean }) => Promise<CompetitorProductSnapshot>;
  batchTrack: (params: { urls: string[] }) => Promise<CompetitorBatchTrackResponse>;
  autoRegister: (params?: { region?: string }) => Promise<CompetitorAutoRegisterResult>;
  setYunqiToken: (token: string) => Promise<{ success: boolean }>;
  getYunqiToken: () => Promise<{ hasToken?: boolean; token: string | null; tokenPreview?: string | null }>;
  fetchYunqiToken: () => Promise<{
    success: boolean;
    token: string | null;
    tokenPreview?: string | null;
    source?: string | null;
    openedPage?: boolean;
    waitedForLogin?: boolean;
    savedAt?: string;
  }>;
  setYunqiCredentials: (params: { account: string; password: string }) => Promise<{ success: boolean; account: string }>;
  getYunqiCredentials: () => Promise<{ hasCredentials: boolean; account: string | null }>;
  deleteYunqiCredentials: () => Promise<{ success: boolean }>;
  yunqiAutoLogin: () => Promise<{
    success: boolean;
    token: string | null;
    tokenPreview?: string | null;
    autoLogin?: boolean;
    alreadyLoggedIn?: boolean;
  }>;
  visionCompare: (payload: {
    myImage: { url: string; title?: string } | null;
    competitorImages: Array<{ url: string; title?: string; priceText?: string; monthlySales?: number }>;
    context?: { keyword?: string; primaryNeed?: string; videoRate?: number; category?: string };
  }) => Promise<{
    success: boolean;
    myStrengths: string[];
    myWeaknesses: string[];
    competitorTakeaways: Array<{ title?: string; takeaway?: string }>;
    improvements: Array<{ priority?: "P0" | "P1" | "P2"; action?: string }>;
    rawText?: string;
    imageErrors?: Array<{ title: string; error: string }>;
    model?: string;
  }>;
}

interface YunqiDbAPI {
  import: (params: { filePath: string }) => Promise<{ batchId: string; imported: number; skipped: number; total: number }>;
  search: (params: {
    keyword?: string; mallName?: string; mallMode?: string; category?: string;
    minPrice?: number; maxPrice?: number; minDailySales?: number;
    sortBy?: string; sortOrder?: string; page?: number; pageSize?: number;
  }) => Promise<{ items: any[]; total: number; page: number; pageSize: number; totalPages: number }>;
  stats: () => Promise<any>;
  top: (params?: { field?: string; limit?: number }) => Promise<any[]>;
  info: () => Promise<{ dbPath: string; rowCount: number }>;
  syncOnline: (params: { keywords: string[]; maxPages?: number; wareHouseType?: number | null }) => Promise<{
    results: { keyword: string; fetched: number; imported: number; skipped: number; batchId: string }[];
    totalImported: number; totalSkipped: number; syncedAt: string; dbRowCount: number;
  }>;
}

interface ElectronAPI {
  getAppPath: () => Promise<string>;
  selectFile: (filters?: any) => Promise<string | null>;
  automation: AutomationAPI;
  competitor: CompetitorAPI;
  yunqiDb: YunqiDbAPI;
  imageStudio: ImageStudioAPI;
  imageStudioGpt: ImageStudioAPI & { switchProfile: () => Promise<{ profile: string; status: unknown }> };
  erp: ErpAPI;
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
