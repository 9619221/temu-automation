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
  yunduCaptureEnrollSubmit: (params?: { wait?: boolean; timeoutMs?: number }) => Promise<any>;
  yunduEnrollPriced: (params: { activityType?: number; activityThematicId: number; items: Array<{ extCode: string; activityPriceYuan: number; activityStock: number }>; dryRun?: boolean }) => Promise<any>;
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
  analyze: (payload: { files: NativeImagePayload[]; productMode: string; analysisProfile?: string }) => Promise<ImageStudioAnalysis>;
  regenerateAnalysis: (
    payload: { files: NativeImagePayload[]; productMode: string; analysis: ImageStudioAnalysis; analysisProfile?: string }
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
  getBrowserExtensionPolicy?: () => Promise<any>;
  ensureBrowserExtensionPolicy?: () => Promise<any>;
  getUpdateStatus: () => Promise<any>;
  checkForUpdates: () => Promise<any>;
  downloadUpdate: () => Promise<any>;
  quitAndInstallUpdate: () => Promise<boolean>;
  openLogDirectory: () => Promise<string>;
  getExtensionDirectory?: () => Promise<string>;
  openExtensionDirectory?: () => Promise<string>;
  openChromeExtensions?: () => Promise<string>;
  openExternal: (url: string) => Promise<string>;
  openPdf?: (payload: { base64: string; filename?: string }) => Promise<string>;
  openLogisticsWindow?: (billNo: string) => Promise<string>;
  readWorkflowPackLogs?: (params?: { limit?: number }) => Promise<{
    logFile?: string;
    diagnosticLogFile?: string;
    imageStudioLogFile?: string;
    entries?: any[];
  }>;
  clearWorkflowPackLogs?: () => Promise<{
    logFile?: string;
    diagnosticLogFile?: string;
    imageStudioLogFile?: string;
    cleared?: boolean;
  }>;
}

interface StoreAPI {
  get: (key: string) => Promise<any>;
  getMany: (keys: string[]) => Promise<Record<string, any>>;
  set: (key: string, data: any) => Promise<boolean>;
  setMany: (entries: Record<string, any>) => Promise<boolean>;
}

interface ConsignDeliverUnifiedParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  shop?: string;
  skuCode?: string;
  dateFrom?: string;
  dateTo?: string;
  source?: "all" | "cloud" | "jst" | "both";
  companyId?: string;
}

interface ConsignDeliverUnifiedRawCloud {
  stock_order_no?: string | null;
  row_key?: string | null;
  mall_id?: string | null;
  site?: string | null;
  parent_order_no?: string | null;
  delivery_batch_sn?: string | null;
  product_id?: string | null;
  skc_id?: string | null;
  sku_id?: string | null;
  sku_ext_code?: string | null;
  temu_status?: string | null;
  demand_qty?: number | null;
  delivered_qty?: number | null;
  inbound_qty?: number | null;
  order_amount_cents?: number | null;
  currency?: string | null;
  product_name?: string | null;
  spec_name?: string | null;
  delivery_order_sn?: string | null;
  receive_warehouse_id?: string | null;
  receive_warehouse_name?: string | null;
  warehouse_group?: string | null;
  urgency_info?: string | null;
  order_time?: string | null;
  latest_ship_at?: string | null;
  logistics_info?: string | null;
  item_count?: number | null;
}

interface ConsignDeliverUnifiedRawJst {
  o_id?: number | null;
  so_id?: string | null;
  shop_name?: string | null;
  status?: string | null;
  src_status?: string | null;
  shop_status_text?: string | null;
  item_amount?: number | null;
  items_qty?: number | null;
  order_date?: string | null;
  send_date?: string | null;
  outer_deliver_no?: string | null;
  supplier_name?: string | null;
  logistics_company?: string | null;
  l_id?: string | null;
  sku_info?: string | null;
  skus?: string | null;
  currency?: string | null;
}

interface ConsignDeliverUnifiedRow {
  soId: string | null;
  shopName: string | null;
  status: string | null;
  itemAmount: number | null;
  itemsQty: number | null;
  localShipQty?: number | null;
  orderDate: string | null;
  outerDeliverNo: string | null;
  supplierName: string | null;
  source: "cloud" | "jst" | "both";
  localStatusOverride?: string | null;
  inventoryDeducted?: boolean;
  rawCloud: ConsignDeliverUnifiedRawCloud | null;
  rawJst: ConsignDeliverUnifiedRawJst | null;
}

interface ConsignDeliverUnifiedResult {
  ok?: boolean;
  rows: ConsignDeliverUnifiedRow[];
  total: number;
  page: number;
  pageSize: number;
  sourceBreakdown: {
    cloud_only: number;
    jst_only: number;
    both: number;
  };
  // 各「显示状态」(jst_status || cloud_temu_status) 的条数，仅受搜索约束。
  // 旧服务器不返回此字段，前端需做缺省兜底。
  statusBreakdown?: Record<string, number>;
}

interface ErpStatus {
  initialized: boolean;
  mode?: "unset" | "host" | "client";
  runtime?: ErpClientStatus;
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

interface ErpClientStatus {
  mode: "unset" | "host" | "client";
  isClientMode: boolean;
  serverUrl?: string;
  currentUser?: ErpUserSession | null;
  connected?: boolean;
  updatedAt?: string | null;
  dbInitialized?: boolean;
}

interface ErpDiscoveredController {
  url: string;
  service: string;
  name?: string;
  startedAt?: string | null;
}

interface ErpListParams {
  accountId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  inboundReceiptLimit?: number;
  inboundReceiptOffset?: number;
  inventoryBatchLimit?: number;
  inventoryBatchOffset?: number;
}

interface ErpPageResult<T = any> {
  rows: T[];
  total: number;
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
  wsClientCount?: number;
  lastError?: string | null;
}

interface ErpJushuitanSource {
  id: string;
  companyId: string;
  sourceKey: string;
  method: string;
  label: string;
  category: string;
  enabled: boolean;
  syncMode: string;
  pageSize: number;
  lastSyncedAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  totalSynced?: number;
  rawCount?: number;
}

interface ErpJushuitanStatus {
  companyId: string;
  configured?: boolean;
  rawCount?: number;
  auth?: Record<string, any>;
  sources: ErpJushuitanSource[];
  latestJobs: any[];
}

interface ErpJushuitanAPI {
  getStatus: (params?: Record<string, any>) => Promise<ErpJushuitanStatus>;
  saveSource: (payload: Record<string, any>) => Promise<ErpJushuitanSource>;
  importFile: (payload: { filePath: string; sourceKey?: string }, options?: { timeoutMs?: number }) => Promise<any>;
  openWebCollector: (payload?: { url?: string }, options?: { timeoutMs?: number }) => Promise<any>;
  collectWebPage: (
    payload?: {
      url?: string;
      sourceKey?: string;
      maxPages?: number;
      maxScrolls?: number;
      maxRecords?: number;
      autoNext?: boolean;
      captureNetwork?: boolean;
    },
    options?: { timeoutMs?: number },
  ) => Promise<any>;
  closeWebCollector: (payload?: Record<string, any>) => Promise<any>;
  syncOperational: (payload?: { sourceKeys?: string[] }, options?: { timeoutMs?: number }) => Promise<any>;
  listJobs: (params?: Record<string, any>) => Promise<any[]>;
  listRaw: (params?: Record<string, any>) => Promise<any[]>;
}

interface ErpPurchaseUpdateEvent {
  type: "purchase:update";
  action: string;
  prId?: string | null;
  poId?: string | null;
  actorRole?: string | null;
  at?: string;
}

interface ErpUserUpdateEvent {
  type: "user:update";
  action: string;
  userId?: string | null;
  role?: string | null;
  status?: string | null;
  actorRole?: string | null;
  at?: string;
}

interface ErpAuthExpiredEvent {
  type: "auth:expired";
  message?: string | null;
  path?: string | null;
  at?: string;
}

interface TemuOpenApiBinding {
  mallId: string;
  mallName: string;
  region: string;
  appKey: string;
  authorized: boolean;
  semiManaged: boolean;
  scopeCount: number;
  apiScopeList?: string[];
  accessTokenExpiresAt: string;
  status: string;
  authorizedAt: string;
  updatedAt: string;
  productSyncCount?: number;
  lastProductSyncAt?: string;
  lastProductSyncStatus?: string;
  lastProductSyncError?: string;
  lastRecordsSyncAt?: string;
  lastRecordsSyncStatus?: string;
  lastRecordsSyncError?: string;
  recordsSyncSummary?: Record<string, number>;
}

interface ErpAPI {
  getStatus: () => Promise<ErpStatus>;
  runMigrations: () => Promise<ErpStatus>;
  syncTemuSales?: (payload: any) => Promise<{ ok: boolean; result?: any; error?: string }>;
  syncTemuAdditionalFromCloud?: (payload: any) => Promise<{ ok: boolean; result?: any; error?: string }>;
  syncTemuReviewsFromCloud?: (payload: any) => Promise<{ ok: boolean; result?: any; error?: string }>;
  syncTemuImagesFromCloud?: (payload: any) => Promise<{ ok: boolean; result?: any; error?: string }>;
  syncTemuSettlementIncomeFromCloud?: (payload: any) => Promise<{ ok: boolean; result?: any; error?: string }>;
  getEnums: () => Promise<Record<string, Record<string, string>>>;
  client: {
    getStatus: () => Promise<ErpClientStatus>;
    setHostMode: () => Promise<ErpClientStatus>;
    setClientMode: (payload: { serverUrl: string }) => Promise<ErpClientStatus>;
    discover: (payload?: { port?: number; timeoutMs?: number; concurrency?: number }) => Promise<ErpDiscoveredController[]>;
  };
  auth: {
    getStatus: () => Promise<ErpAuthStatus>;
    getCurrentUser: () => Promise<ErpUserSession | null>;
    createFirstAdmin: (payload: { name: string; accessCode: string }) => Promise<ErpAuthStatus>;
    login: (payload: { login: string; accessCode: string; serverUrl?: string }) => Promise<ErpAuthStatus>;
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
    delete: (payload: { id?: string; accountId?: string }) => Promise<any>;
  };
  temuOpenApi: {
    list: () => Promise<{ malls: TemuOpenApiBinding[] }>;
    bind: (payload: {
      accessToken: string;
      region?: string;
      mallName?: string;
      mallId?: string;
      appKey?: string;
      appSecret?: string;
    }) => Promise<TemuOpenApiBinding>;
    unbind: (payload: { mallId: string }) => Promise<{ ok: boolean; mallId: string }>;
    syncProducts: (payload?: { mallId?: string }) => Promise<{ malls: number; results: any[] }>;
    listProducts: (payload?: { mallId?: string; limit?: number; offset?: number }) => Promise<{
      counts?: { mallId: string; productCount: number }[];
      products?: any[];
      total?: number;
    }>;
    listProductsAsSkc: () => Promise<{ rows: any[] }>;
    listSales: () => Promise<{ rows: any[] }>;
    listRecords: (source: string) => Promise<{ rows: any[] }>;
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
  permission: {
    getProfile: () => Promise<any>;
    upsertRole: (payload?: any) => Promise<any>;
    upsertScope: (payload?: any) => Promise<any>;
    adminView: (params?: any) => Promise<any>;
    setRoleAccess: (payload?: any) => Promise<any>;
    setUserOverrides: (payload?: any) => Promise<any>;
    setUserScopes: (payload?: any) => Promise<any>;
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
      supplierCode?: string;
      supplierLevel?: string;
      paymentTerms?: string;
      leadDays?: number | null;
      taxRate?: number | null;
      settlementCurrency?: string;
      remark?: string;
      status?: string;
    }) => Promise<any>;
    importFeishuOnce: (payload: {
      filePath: string;
      sourceUrl?: string;
    }) => Promise<{
      source: "feishu";
      sourceUrl?: string | null;
      filePath: string;
      total: number;
      imported: number;
      created: number;
      updated: number;
      skipped: number;
      errors?: Array<{ row: number; reason: string }>;
    }>;
  };
  sku: {
    list: (params?: ErpListParams) => Promise<any[]>;
    stockDetails: (params?: {
      skuId?: string;
      internalSkuCode?: string;
      limit?: number;
      offset?: number;
    }) => Promise<{
      rows: any[];
      total: number;
      summary?: {
        receivedQty?: number;
        availableQty?: number;
        reservedQty?: number;
        blockedQty?: number;
        defectiveQty?: number;
        reworkQty?: number;
        costedQty?: number;
        missingCostQty?: number;
        stockValue?: number;
      };
    }>;
    listUnmappedPage: (params?: ErpListParams) => Promise<ErpPageResult>;
    create: (payload: {
      id?: string;
      accountId?: string;
      internalSkuCode?: string;
      productName: string;
      temuSkuId?: string;
      temuProductId?: string;
      temuSkcId?: string;
      colorSpec?: string;
      category?: string;
      imageUrl?: string;
      supplierId?: string;
      skuType?: string;
      bundleCostPrice?: number | null;
      status?: string;
    }) => Promise<any>;
    delete: (payload: { id?: string; skuId?: string }) => Promise<any>;
    saveBundle: (payload: {
      id?: string;
      accountId?: string;
      internalSkuCode?: string;
      productName: string;
      colorSpec?: string;
      status?: string;
      components: Array<{
        skuId: string;
        qty: number;
        unitCost?: number | null;
      }>;
    }) => Promise<any>;
    bundleComponents: (params: {
      bundleSkuId?: string;
      skuId?: string;
    }) => Promise<any[]>;
    sync: (options?: { mode?: "full" | "incremental"; companyId?: string }) => Promise<any>;
    cacheStatus: (options?: { companyId?: string }) => Promise<{
      companyId: string | null;
      count: number;
      populated: boolean;
      cursor?: string | null;
      lastFullAt?: string | null;
      lastSyncAt?: string | null;
      lastReconcileAt?: string | null;
      syncing?: boolean;
    }>;
  };
  mapping: {
    list: (params?: ErpListParams) => Promise<any[]>;
    page: (params?: ErpListParams) => Promise<ErpPageResult>;
    sync: (options?: { mode?: "full" | "incremental"; companyId?: string }) => Promise<any>;
    cacheStatus: (options?: { companyId?: string }) => Promise<{
      companyId: string | null;
      count: number;
      populated: boolean;
      cursor?: string | null;
      lastFullAt?: string | null;
      lastSyncAt?: string | null;
      lastReconcileAt?: string | null;
      syncing?: boolean;
    }>;
  };
  purchaseReturn: {
    list: (params?: Record<string, any>) => Promise<any[]>;
    page: (params?: Record<string, any>) => Promise<{ rows: any[]; total: number }>;
    items: (params?: { ioId?: number; ioIds?: number[]; companyId?: string }) => Promise<any[]>;
    sync: (options?: { mode?: "full" | "incremental"; companyId?: string }) => Promise<any>;
    cacheStatus: (options?: { companyId?: string }) => Promise<{
      companyId: string | null;
      headCount: number;
      itemCount: number;
      populated: boolean;
      head?: { cursor?: string | null; lastFullAt?: string | null; lastSyncAt?: string | null; lastReconcileAt?: string | null; syncing?: boolean };
      item?: { cursor?: string | null; lastFullAt?: string | null; lastSyncAt?: string | null; lastReconcileAt?: string | null; syncing?: boolean };
    }>;
    action: (payload: {
      action: "create_draft" | "update_draft" | "effective" | "cancel" | "delete_draft";
      id?: string;
      companyId?: string;
      supplierName?: string;
      accountId?: string;
      labels?: string | null;
      remark?: string | null;
      items?: Array<{
        skuId: string;
        productName?: string | null;
        propertiesValue?: string | null;
        picUrl?: string | null;
        qty: number;
        costPrice: number;
        iId?: string | null;
        supplierIId?: string | null;
        supplierSkuId?: string | null;
        remark?: string | null;
      }>;
    }) => Promise<any>;
  };
  consignAfterSale: {
    list: (params?: Record<string, any>) => Promise<any[]>;
    page: (params?: Record<string, any>) => Promise<{ rows: any[]; total: number }>;
    items: (params?: { asId?: number; asIds?: number[]; companyId?: string }) => Promise<any[]>;
    sync: (options?: { mode?: "full" | "incremental"; companyId?: string }) => Promise<any>;
    cacheStatus: (options?: { companyId?: string }) => Promise<{
      companyId: string | null;
      headCount: number;
      itemCount: number;
      populated: boolean;
      head?: { cursor?: string | null; lastFullAt?: string | null; lastSyncAt?: string | null; lastReconcileAt?: string | null; syncing?: boolean };
      item?: { cursor?: string | null; lastFullAt?: string | null; lastSyncAt?: string | null; lastReconcileAt?: string | null; syncing?: boolean };
    }>;
    confirmReceipt: (payload: {
      outerAsId: string;
      asId?: number | null;
      source?: string;
      remark?: string;
      items: Array<{
        temuSkuId?: string | null;
        temuSkcId?: string | null;
        internalSkuCode?: string | null;
        productName?: string | null;
        receivedQty: number;
      }>;
    }) => Promise<{ outerAsId: string; receiptStatus: string; confirmedAt: string; items: any[] }>;
    receipts: (params?: { companyId?: string }) => Promise<Array<{
      outerAsId: string;
      asId?: number | null;
      source?: string;
      receiptStatus: string;
      confirmedBy?: string | null;
      confirmedAt?: string | null;
    }>>;
  };
  consignDeliver: {
    list: (params?: Record<string, any>) => Promise<any[]>;
    page: (params?: { page?: number; pageSize?: number; limit?: number; offset?: number; search?: string; status?: string; companyId?: string }) => Promise<{ rows: any[]; total: number }>;
    items: (params?: { o_id?: number | string; oId?: number | string; companyId?: string }) => Promise<any[]>;
    cloudItems: (params?: { mallId?: string; soId?: string; mall_id?: string; so_id?: string }) => Promise<any[]>;
    cacheStatus: (params?: { companyId?: string }) => Promise<{ count: number; lastImportedAt: string | null; lastUpdatedAt: string | null }>;
    unified: (params?: ConsignDeliverUnifiedParams) => Promise<ConsignDeliverUnifiedResult>;
  };
  otherInout: {
    list: (params?: Record<string, any>) => Promise<any[]>;
    page: (params?: { page?: number; pageSize?: number; limit?: number; offset?: number; search?: string; status?: string; type?: string; companyId?: string }) => Promise<{ rows: any[]; total: number }>;
    items: (params?: { ioId?: number | string; io_id?: number | string; companyId?: string }) => Promise<any[]>;
    cacheStatus: (params?: { companyId?: string }) => Promise<{ count: number; lastImportedAt: string | null; lastUpdatedAt: string | null }>;
  };
  purchase: {
    workbench: (params?: ErpListParams, options?: { timeoutMs?: number }) => Promise<any>;
    action: (payload: Record<string, any>, options?: { timeoutMs?: number }) => Promise<any>;
    local1688Inquiry?: (payload: Record<string, any>) => Promise<any>;
    open1688Detail?: (payload: Record<string, any>) => Promise<any>;
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
  inventory: {
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
  jushuitan: ErpJushuitanAPI;
  reports?: {
    multiStore: (options?: { includeTest?: boolean }) => Promise<ErpMultiStoreReportResponse>;
    mallDict: () => Promise<ErpMallDictResponse>;
    setMallOwner: (payload: { mallId: string; owner: string | null }) => Promise<ErpSetMallOwnerResponse>;
    skuSales: (options?: { includeTest?: boolean }) => Promise<ErpSkuSalesResponse>;
    riskList: (options?: { includeTest?: boolean }) => Promise<ErpRiskListResponse>;
    activityList: (options?: { includeTest?: boolean }) => Promise<ErpActivityListResponse>;
    shopHealth: (options?: { includeTest?: boolean }) => Promise<ErpShopHealthResponse>;
    stockOrders: (options?: { includeTest?: boolean }) => Promise<ErpStockOrderResponse>;
    salesTrend: (options?: { includeTest?: boolean; days?: number }) => Promise<ErpSalesTrendResponse>;
    productPanel: (options?: { includeTest?: boolean }) => Promise<ErpProductPanelResponse>;
    openapiQc: (options?: { includeTest?: boolean }) => Promise<{ ok: boolean; data?: { generated_at: number; row_count: number; rows: unknown[]; source?: string }; error?: string }>;
    firstShipToday: (options?: { includeTest?: boolean }) => Promise<{ ok: boolean; data?: { generated_at: number; stat_date: string; row_count: number; rows: unknown[]; source?: string }; error?: string }>;
    goodsCreatedToday: (options?: { includeTest?: boolean }) => Promise<{ ok: boolean; data?: { generated_at: number; stat_date: string; row_count: number; rows: unknown[]; source?: string }; error?: string }>;
    qualityPanel: (options?: { includeTest?: boolean }) => Promise<{ ok: boolean; data?: { generated_at: number; row_count: number; rows: unknown[]; shops?: unknown[]; attached?: boolean; source?: string }; error?: string }>;
    reviews: (options?: { includeTest?: boolean }) => Promise<{ ok: boolean; data?: { generated_at: number; row_count: number; rows: unknown[]; summary?: { total: number; avg_score: number | null; bad_count: number; bad_rate: number | null; pic_count: number }; source?: string }; error?: string }>;
    highPriceFlow: (options?: { includeTest?: boolean; days?: number }) => Promise<{ ok: boolean; data?: { generated_at: number; row_count: number; rows: unknown[]; attached?: boolean; source?: string }; error?: string }>;
    qcFlawImages: (options?: { mallId?: string; qcBillId?: string }) => Promise<{ ok: boolean; data?: { count: number; images: string[] }; error?: string }>;
    productTrend: (options?: { productId?: string }) => Promise<{ ok: boolean; data?: { product_id: string | null; rows: Array<{ date: string; qty: number; revenue: number }>; attached?: boolean; source?: string }; error?: string }>;
    purchase: (options?: { includeTest?: boolean }) => Promise<ErpPurchaseReportResponse>;
    warehouseInventory: (options?: { includeTest?: boolean }) => Promise<{ ok: boolean; data?: { generated_at: number; store_count: number; summary: { total_qty: number; total_value: number; available_qty: number; reserved_qty: number; sku_count: number }; stores: Array<{ account_id: string; account_name: string | null; sku_count: number; available_qty: number; reserved_qty: number; blocked_qty: number; defective_qty: number; rework_qty: number; total_qty: number; stock_value: number; batch_count: number }> }; error?: string }>;
    settlement: (options?: { startDate?: string; endDate?: string }) => Promise<{ ok: boolean; data?: { stores: Array<{ mall_id: string; store_code: string | null; mall_name: string | null; owner: string | null; fund_detail: { in_total: number; out_total: number; by_category: Record<string, number> } | null; revenue: number; cost: number; qty: number; settlement_detail: any | null }>; fund_detail_available: boolean; financials_available: boolean; date_range: { start: string | null; end: string | null } }; error?: string }>;
  };
  opTask?: {
    list: () => Promise<{ ok: boolean; data?: { rows: Array<{ task_key: string; status: "done" | "ignored"; owner: string | null; note: string | null; updated_at: number }> }; error?: string }>;
    set: (payload: { taskKey: string; status: "done" | "ignored" | null; owner?: string | null }) => Promise<{ ok: boolean; data?: { changes: number }; error?: string }>;
  };
  enroll?: {
    create: (payload: { tasks: Array<{ mall_id: string; site?: string; activity_type?: number | null; activity_thematic_id: string; product_list: unknown[] }> }) => Promise<{ ok: boolean; data?: { rows: Array<{ ok: boolean; task_id: string | null; mall_id: string | null; error: string | null }> }; error?: string }>;
    status: (payload: { taskIds: string[] }) => Promise<{ ok: boolean; data?: { tasks: Array<{ task_id: string; status: string; result: unknown; created_at: string; done_at: string | null }> }; error?: string }>;
  };
  events?: {
    onPurchaseUpdate: (handler: (payload: ErpPurchaseUpdateEvent) => void) => () => void;
    onUserUpdate: (handler: (payload: ErpUserUpdateEvent) => void) => () => void;
    onAuthExpired: (handler: (payload: ErpAuthExpiredEvent) => void) => () => void;
  };
}

interface ErpMultiStoreReportStore {
  mall_id: string;
  mall_name: string | null;
  site: string | null;
  mall_last_seen: string | null;
  store_code: string | null;
  store_status: 'active' | 'test' | 'unknown' | string;
  dict_remark: string | null;
  owner: string | null;
  financials: ErpStoreFinancials | null;
  settlement: ErpStoreSettlement | null;
  settlement_detail: ErpStoreSettlementDetail | null;
  sales: {
    today_qty: number;
    last7d_qty: number;
    last30d_qty: number;
    sku_count: number;
  };
  stock_orders: {
    total: number;
    pending: number;
    demand_qty: number;
    delivered_qty: number;
  };
  activities: {
    count: number;
    unique: number;
    skc_count: number;
  };
  shop_stats: {
    stat_date: string | null;
    sale_volume: number;
    sale_7d: number;
    sale_30d: number;
    on_sale_skc: number;
    wait_skc: number;
    lack_skc: number;
    advice_prepare_skc: number;
    about_to_sell_out_skc: number;
    already_sold_out_skc: number;
    high_price_limit_skc: number;
    after_sale_ratio_90d: string | number | null;
    last_updated_at: string | null;
  };
  after_sales: {
    count: number;
  };
  health: {
    last_capture_at: number | null;
    captures_total: number;
    lag_seconds: number | null;
  };
}

interface ErpStoreFinancialsWindow {
  revenue: number;
  cost: number;
  gross_profit: number;
  qty: number;
}

interface ErpStoreFinancials {
  latest_date: string | null;
  today: ErpStoreFinancialsWindow;
  last7d: ErpStoreFinancialsWindow & { revenue_prev: number; rev_wow: number | null };
  last30d: ErpStoreFinancialsWindow & { revenue_prev: number; rev_mom: number | null };
  cost_coverage: number | null;
  trend_daily: Array<{ date: string; revenue: number; gross_profit: number }>;
}

interface ErpStoreSettlement {
  latest_date: string | null;
  today: { income: number };
  last7d: { income: number; income_prev: number; income_wow: number | null };
  last30d: { income: number; income_prev: number; income_mom: number | null };
  trend_daily: Array<{ date: string; income: number }>;
}

interface ErpStoreSettlementDetailBucket {
  count: number;
  estimated: number;
  sales_receipt: number;
  chargeback: number;
  subsidy: number;
  total: number;
}

interface ErpStoreSettlementDetail {
  currency: string;
  wait_settlement: ErpStoreSettlementDetailBucket;
  in_settlement: ErpStoreSettlementDetailBucket;
  settled: ErpStoreSettlementDetailBucket;
}

interface ErpMultiStoreReportResponse {
  ok: boolean;
  error?: string;
  data?: {
    generated_at: number;
    cloud_tenant_id: string | null;
    store_count: number;
    financials_available: boolean;
    settlement_available: boolean;
    settlement_detail_available: boolean;
    stores: ErpMultiStoreReportStore[];
    unmapped: ErpMultiStoreReportStore[];
  };
}

interface ErpSetMallOwnerResponse {
  ok: boolean;
  error?: string;
  data?: { changes: number };
}

interface ErpSkuSalesRow {
  mall_id: string;
  store_code: string | null;
  mall_name: string | null;
  skc_id: string | null;
  sku_ext_code: string | null;
  product_id: string | null;
  title: string | null;
  category: string | null;
  today: number;
  last7d: number;
  last30d: number;
  stock: number;
  occupy: number;
  advice_qty: number;
  sale_days: number | null;
  declared_price: number | null;
  stat_date: string | null;
}

interface ErpSkuSalesResponse {
  ok: boolean;
  error?: string;
  data?: {
    generated_at: number;
    row_count: number;
    rows: ErpSkuSalesRow[];
    attached?: boolean;
  };
}

interface ErpRiskRow {
  mall_id: string;
  store_code: string | null;
  mall_name: string | null;
  risk_type: string | null;
  severity: string | null;
  title: string | null;
  status: string | null;
  product_id: string | null;
  skc_id: string | null;
  quantity: number;
  stat_date: string | null;
}

interface ErpRiskListResponse {
  ok: boolean;
  error?: string;
  data?: { generated_at: number; row_count: number; rows: ErpRiskRow[]; attached?: boolean };
}

interface ErpActivityRow {
  mall_id: string;
  store_code: string | null;
  mall_name: string | null;
  kind: string | null;
  title: string | null;
  status: string | null;
  sku_ext_code: string | null;
  skc_id: string | null;
  signup_price: number | null;
  suggested_price: number | null;
  price_diff: number | null;
  activity_stock: number;
  cost: number | null;
  end_at: string | null;
  stat_date: string | null;
}

interface ErpActivityListResponse {
  ok: boolean;
  error?: string;
  data?: { generated_at: number; row_count: number; rows: ErpActivityRow[]; attached?: boolean };
}

interface ErpShopHealthRow {
  mall_id: string;
  store_code: string | null;
  mall_name: string | null;
  owner: string | null;
  sale_volume: number;
  sale_7d: number;
  sale_30d: number;
  on_sale: number;
  wait_online: number;
  lack_skc: number;
  advice_prepare_skc: number;
  about_to_sell_out: number;
  already_sold_out: number;
  high_price_limit: number;
  after_sale_ratio_90d: number | null;
  stat_date: string | null;
}

interface ErpShopHealthResponse {
  ok: boolean;
  error?: string;
  data?: { generated_at: number; row_count: number; rows: ErpShopHealthRow[]; attached?: boolean };
}

interface ErpStockOrderRow {
  mall_id: string;
  store_code: string | null;
  mall_name: string | null;
  sku_ext_code: string | null;
  product_name: string | null;
  spec_name: string | null;
  source_type: string | null;
  demand_qty: number;
  delivered_qty: number;
  gap: number;
  shipping_qty: number;
  inbound_qty: number;
  latest_ship_at: string | null;
  warehouse: string | null;
  order_no: string | null;
}

interface ErpStockOrderResponse {
  ok: boolean;
  error?: string;
  data?: { generated_at: number; row_count: number; rows: ErpStockOrderRow[]; attached?: boolean };
}

interface ErpSalesTrendRow {
  mall_id: string;
  store_code: string | null;
  mall_name: string | null;
  stat_date: string;
  sales: number;
}

interface ErpSalesTrendResponse {
  ok: boolean;
  error?: string;
  data?: { generated_at: number; row_count: number; rows: ErpSalesTrendRow[]; attached?: boolean };
}

interface ErpProductPanelRow {
  mall_id: string;
  product_id: string;
  store_code: string | null;
  mall_name: string | null;
  title: string | null;
  thumb: string | null;
  skc_codes: string | null;
  sku_codes: string | null;
  declared_price: number | null;
  score: number | null;
  comments: number | null;
  stock: number | null;
  occupy: number | null;
  unavail: number | null;
  advice: number | null;
  lack: number | null;
  lack_qty: number | null;
  shipping: number | null;
  total_stock: number | null;
  expose: number | null;
  click: number | null;
  pay: number | null;
  conv: number | null;
  grow: string | null;
  limited: boolean;
  act_cnt: number;
  min_price: number | null;
  compliance: string | null;
  skus_detail?: { skc_id: string | null; sku_ext_code: string | null; declared_price: number | null; today: number; last7d: number; sale_days: number | null; stock: number; occupy: number; advice_qty: number; lack_qty?: number }[];
}

interface ErpProductPanelResponse {
  ok: boolean;
  error?: string;
  data?: { generated_at: number; row_count: number; rows: ErpProductPanelRow[]; attached?: boolean };
}

interface ErpPurchaseOrderRow {
  id: string;
  po_no: string;
  status: string;
  status_label: string;
  payment_status: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  buyer_name: string | null;
  account_id: string | null;
  account_name: string | null;
  goods_amount: number;
  freight_amount: number;
  total_amount: number;
  paid_amount: number;
  unpaid_amount: number;
  line_count: number;
  total_qty: number;
  received_qty: number;
  inbound_pct: number;
  created_at: string | null;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  paid_at: string | null;
}

interface ErpPurchaseReportResponse {
  ok: boolean;
  error?: string;
  data?: {
    generated_at: number;
    row_count: number;
    orders_shown: number;
    orders_truncated: boolean;
    summary: {
      po_count: number; cancelled_count: number;
      goods_amount: number; freight_amount: number; total_amount: number;
      paid_amount: number; unpaid_amount: number; pending_inbound_amount: number;
      this_month_amount: number; this_month_count: number; payment_rate: number;
    };
    capital: {
      paid_done: { count: number; amount: number };
      paid_undone: { count: number; amount: number };
      unpaid_done: { count: number; amount: number };
      unpaid_undone: { count: number; amount: number };
    };
    aging: { bucket: string; count: number; amount: number }[];
    cash_outflow: { coverage: number; monthly: { month: string; count: number; amount: number }[] };
    paid_unshipped: { count: number; amount: number; aging: { bucket: string; count: number; amount: number }[] };
    by_status: { status: string; label: string; count: number; amount: number }[];
    by_supplier: { supplier_id: string | null; supplier_name: string; count: number; amount: number; paid: number }[];
    monthly: { month: string; count: number; amount: number }[];
    orders: ErpPurchaseOrderRow[];
  };
}

interface ErpMallDictEntry {
  mall_id: string;
  mall_name: string | null;
  store_code: string | null;
  site: string | null;
  status: string | null;
  remark: string | null;
  owner?: string | null;
}

interface ErpMallDictResponse {
  ok: boolean;
  error?: string;
  data?: {
    malls: ErpMallDictEntry[];
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
  selectionAdd: (params: any) => Promise<{ ok: boolean; goodsId?: string; reason?: string }>;
  selectionRemove: (params: { goodsId: string }) => Promise<{ ok: boolean; removed?: number }>;
  selectionUpdate: (params: { goodsId: string; status?: string; note?: string }) => Promise<{ ok: boolean; changed?: number; reason?: string }>;
  selectionList: (params?: { status?: string }) => Promise<{ rows: any[]; summary: Record<string, number> }>;
  selectionIds: () => Promise<string[]>;
  categories: () => Promise<Array<{ cat_id: number; cat_name: string; cat_en_name: string; cat_level: number; parent_cat_id: number; is_leaf: number }>>;
}

interface AutoImageSwapResultItem {
  spuId: string;
  success: boolean;
  status: "pending" | "processing" | "done" | "error" | "missing" | "empty";
  files: number;
  message: string;
}

interface AutoImageSwapProgress {
  taskId: string;
  flowType: string;
  running: boolean;
  paused: boolean;
  status: string;
  total: number;
  completed: number;
  current: string;
  step: string;
  message: string;
  results: AutoImageSwapResultItem[];
  successCount: number;
  failCount: number;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
}

interface AutoImageSwapAPI {
  pickDir: (defaultPath?: string) => Promise<string | null>;
  run: (params: {
    taskId?: string;
    rootDir: string;
    identifiers: string[];
  }) => Promise<{
    success: boolean;
    taskId: string;
    total: number;
    successCount: number;
    failCount: number;
    results: AutoImageSwapResultItem[];
  }>;
  getProgress: (taskId?: string) => Promise<AutoImageSwapProgress>;
}

export interface BrowserMultiAccount {
  id: string;
  name: string;
  group?: string;
  startUrl?: string;
  proxy?: string;
  userAgent?: string;
  extraExtensions?: string[];
  note?: string;
}

export interface BrowserMultiConfig {
  chromePath?: string;
  sharedExtensions?: string[];
}

interface BrowserMultiAPI {
  findChrome: () => Promise<string>;
  launch: (account: BrowserMultiAccount, config: BrowserMultiConfig) => Promise<{ pid: number; profileDir: string }>;
  close: (accountId: string) => Promise<boolean>;
  listRunning: () => Promise<string[]>;
  openProfileDir: (accountId: string) => Promise<boolean>;
  deleteProfile: (accountId: string) => Promise<{ ok: boolean; err?: string; dir?: string }>;
  pickFile: (opts?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
  pickDir: () => Promise<string | null>;
}

interface ElectronAPI {
  getAppPath: () => Promise<string>;
  selectFile: (filters?: any) => Promise<string | null>;
  perf?: {
    getEntries: () => Array<{ channel: string; ms: number; error: boolean; at: number }>;
    clear: () => void;
  };
  automation: AutomationAPI;
  competitor: CompetitorAPI;
  yunqiDb: YunqiDbAPI;
  imageStudio: ImageStudioAPI;
  imageStudioGpt: ImageStudioAPI & { switchProfile: () => Promise<{ profile: string; status: unknown }> };
  erp: ErpAPI;
  app: AppAPI;
  store: StoreAPI;
  autoImageSwap: AutoImageSwapAPI;
  browserMulti: BrowserMultiAPI;
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
