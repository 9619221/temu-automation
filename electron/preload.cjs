const { contextBridge, ipcRenderer } = require("electron");

let erpEventSubscriptionCount = 0;

function retainErpEventSubscription() {
  erpEventSubscriptionCount += 1;
  if (erpEventSubscriptionCount === 1) {
    ipcRenderer.send("erp:events:subscribe");
  }
  return () => {
    erpEventSubscriptionCount = Math.max(0, erpEventSubscriptionCount - 1);
    if (erpEventSubscriptionCount === 0) {
      ipcRenderer.send("erp:events:unsubscribe");
    }
  };
}

function createImageStudioApi(profile) {
  const ensureProfile = () => ipcRenderer.invoke("image-studio:switch-profile", profile);
  const withProfile = (fn) => async (...args) => {
    await ensureProfile();
    return fn(...args);
  };

  return {
    switchProfile: ensureProfile,
    getStatus: withProfile(() => ipcRenderer.invoke("image-studio:get-status")),
    ensureRunning: withProfile(() => ipcRenderer.invoke("image-studio:ensure-running")),
    restart: withProfile(() => ipcRenderer.invoke("image-studio:restart")),
    getConfig: withProfile(() => ipcRenderer.invoke("image-studio:get-config")),
    updateConfig: withProfile((payload) => ipcRenderer.invoke("image-studio:update-config", payload)),
    openExternal: withProfile(() => ipcRenderer.invoke("image-studio:open-external")),
    detectComponents: withProfile((payload) => ipcRenderer.invoke("image-studio:detect-components", payload)),
    analyze: withProfile((payload) => ipcRenderer.invoke("image-studio:analyze", payload)),
    regenerateAnalysis: withProfile((payload) => ipcRenderer.invoke("image-studio:regenerate-analysis", payload)),
    translate: withProfile((payload) => ipcRenderer.invoke("image-studio:translate", payload)),
    generatePlans: withProfile((payload) => ipcRenderer.invoke("image-studio:generate-plans", payload)),
    startGenerate: withProfile((payload) => ipcRenderer.invoke("image-studio:start-generate", payload)),
    cancelGenerate: withProfile((jobId) => ipcRenderer.invoke("image-studio:cancel-generate", jobId)),
    listHistory: withProfile(() => ipcRenderer.invoke("image-studio:list-history")),
    getHistoryItem: withProfile((id) => ipcRenderer.invoke("image-studio:get-history-item", id)),
    getHistorySources: withProfile((id) => ipcRenderer.invoke("image-studio:get-history-sources", id)),
    saveHistory: withProfile((payload) => ipcRenderer.invoke("image-studio:save-history", payload)),
    scoreImage: withProfile((payload) => ipcRenderer.invoke("image-studio:score-image", payload)),
    listJobs: withProfile(() => ipcRenderer.invoke("image-studio:list-jobs")),
    getJob: withProfile((jobId) => ipcRenderer.invoke("image-studio:get-job", jobId)),
    clearJob: withProfile((jobId) => ipcRenderer.invoke("image-studio:clear-job", jobId)),
    downloadAll: withProfile((payload) => ipcRenderer.invoke("image-studio:download-all", payload)),
    runDesigner: withProfile((payload) => ipcRenderer.invoke("image-studio:run-designer", payload)),
    composeBriefs: withProfile((payload) => ipcRenderer.invoke("image-studio:compose-briefs", payload)),
    composeImagePrompts: withProfile((payload) => ipcRenderer.invoke("image-studio:compose-image-prompts", payload)),
    regenerateSlot: withProfile((payload) => ipcRenderer.invoke("image-studio:regenerate-slot", payload)),

    // 三步式新版（参考老版 SSE 模式）
    designerAnalyze: withProfile((payload) => ipcRenderer.invoke("image-studio:designer-analyze", payload)),
    designerPlan: withProfile((payload) => ipcRenderer.invoke("image-studio:designer-plan", payload)),
    designerGenerateStart: withProfile((payload) => ipcRenderer.invoke("image-studio:designer-generate-start", payload)),
    designerGenerateCancel: withProfile((jobId) => ipcRenderer.invoke("image-studio:designer-generate-cancel", jobId)),
    onDesignerGenerateEvent: (handler) => {
      const channel = "image-studio:designer-generate-event";
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  };
}

contextBridge.exposeInMainWorld("electronAPI", {
  getAppPath: () => ipcRenderer.invoke("get-app-path"),
  selectFile: (filters) => ipcRenderer.invoke("select-file", filters),

  automation: {
    login: (accountId, phone, password) =>
      ipcRenderer.invoke("automation:login", accountId, phone, password),
    scrapeProducts: () =>
      ipcRenderer.invoke("automation:scrape-products"),
    scrapeOrders: () =>
      ipcRenderer.invoke("automation:scrape-orders"),
    scrapeSales: () =>
      ipcRenderer.invoke("automation:scrape-sales"),
    scrapeFlux: () =>
      ipcRenderer.invoke("automation:scrape-flux"),
    scrapeDashboard: () =>
      ipcRenderer.invoke("automation:scrape-dashboard"),
    scrapeAfterSales: () =>
      ipcRenderer.invoke("automation:scrape-aftersales"),
    scrapeSoldOut: () =>
      ipcRenderer.invoke("automation:scrape-soldout"),
    scrapeGoodsData: () =>
      ipcRenderer.invoke("automation:scrape-goods-data"),
    scrapeActivity: () =>
      ipcRenderer.invoke("automation:scrape-activity"),
    scrapePerformance: () =>
      ipcRenderer.invoke("automation:scrape-performance"),
    scrapeAll: () =>
      ipcRenderer.invoke("automation:scrape-all"),
    filterProductTable: (csvPath) =>
      ipcRenderer.invoke("automation:filter-product-table", csvPath),
    generatePackImages: (params) =>
      ipcRenderer.invoke("automation:generate-pack-images", params),
    autoPricing: (params) =>
      ipcRenderer.invoke("automation:auto-pricing", params),
    startAutoPricing: (params) =>
      ipcRenderer.invoke("automation:auto-pricing", params),
    getProgress: () =>
      ipcRenderer.invoke("automation:get-progress"),
    getTaskProgress: (taskId) =>
      ipcRenderer.invoke("automation:get-task-progress", taskId),
    listTasks: () =>
      ipcRenderer.invoke("automation:list-tasks"),
    readScrapeData: (key) =>
      ipcRenderer.invoke("automation:read-scrape-data", key),
    getScrapeProgress: () =>
      ipcRenderer.invoke("automation:get-scrape-progress"),
    scrapeLifecycle: () =>
      ipcRenderer.invoke("automation:scrape-lifecycle"),
    scrapeBidding: () =>
      ipcRenderer.invoke("automation:scrape-bidding"),
    scrapePriceCompete: () =>
      ipcRenderer.invoke("automation:scrape-price-compete"),
    scrapeHotPlan: () =>
      ipcRenderer.invoke("automation:scrape-hot-plan"),
    scrapeCheckup: () =>
      ipcRenderer.invoke("automation:scrape-checkup"),
    scrapeUSRetrieval: () =>
      ipcRenderer.invoke("automation:scrape-us-retrieval"),
    scrapeDelivery: () =>
      ipcRenderer.invoke("automation:scrape-delivery"),
    scrapeGlobalPerformance: (range) =>
      ipcRenderer.invoke("automation:scrape-global-performance", { range: range || "30d" }),
    scrapeFluxProductDetail: (params) =>
      ipcRenderer.invoke("automation:scrape-flux-product-detail", params || {}),
    scrapeSkcRegionDetail: (productId, range) =>
      ipcRenderer.invoke("automation:scrape-skc-region-detail", { productId, range: range || "30d" }),
    yunduListOverall: (params) => ipcRenderer.invoke("automation:yundu-list-overall", params || {}),
    yunduSiteCount: (params) => ipcRenderer.invoke("automation:yundu-site-count", params || {}),
    yunduHighPriceLimit: (params) => ipcRenderer.invoke("automation:yundu-high-price-limit", params || {}),
    yunduQualityMetrics: (params) => ipcRenderer.invoke("automation:yundu-quality-metrics", params || {}),
    yunduActivityList: (params) => ipcRenderer.invoke("automation:yundu-activity-list", params || {}),
    yunduActivityEnrolled: (params) => ipcRenderer.invoke("automation:yundu-activity-enrolled", params || {}),
    yunduActivityMatch: (params) => ipcRenderer.invoke("automation:yundu-activity-match", params || {}),
    yunduActivitySubmit: (params) => ipcRenderer.invoke("automation:yundu-activity-submit", params || {}),
    yunduAutoEnroll: (params) => ipcRenderer.invoke("automation:yundu-auto-enroll", params || {}),
    pausePricing: (taskId) =>
      ipcRenderer.invoke("automation:pause-pricing", taskId),
    resumePricing: (taskId) =>
      ipcRenderer.invoke("automation:resume-pricing", taskId),
    listDrafts: () =>
      ipcRenderer.invoke("automation:list-drafts"),
    retryDraft: (draftId) =>
      ipcRenderer.invoke("automation:retry-draft", draftId),
    deleteDraft: (draftId) =>
      ipcRenderer.invoke("automation:delete-draft", draftId),
    close: () =>
      ipcRenderer.invoke("automation:close"),
    ping: () =>
      ipcRenderer.invoke("automation:ping"),
  },

  competitor: {
    search: (params) => ipcRenderer.invoke("competitor:search", params),
    track: (params) => ipcRenderer.invoke("competitor:track", params),
    batchTrack: (params) => ipcRenderer.invoke("competitor:batch-track", params),
    autoRegister: (params) => ipcRenderer.invoke("competitor:auto-register", params),
    setYunqiToken: (token) => ipcRenderer.invoke("competitor:set-yunqi-token", token),
    getYunqiToken: () => ipcRenderer.invoke("competitor:get-yunqi-token"),
    fetchYunqiToken: () => ipcRenderer.invoke("competitor:fetch-yunqi-token"),
    setYunqiCredentials: (params) => ipcRenderer.invoke("competitor:set-yunqi-credentials", params),
    getYunqiCredentials: () => ipcRenderer.invoke("competitor:get-yunqi-credentials"),
    deleteYunqiCredentials: () => ipcRenderer.invoke("competitor:delete-yunqi-credentials"),
    yunqiAutoLogin: () => ipcRenderer.invoke("competitor:yunqi-auto-login"),
    visionCompare: (payload) => ipcRenderer.invoke("competitor:vision-compare", payload),
  },

  yunqiDb: {
    import: (params) => ipcRenderer.invoke("yunqi-db:import", params),
    search: (params) => ipcRenderer.invoke("yunqi-db:search", params),
    stats: () => ipcRenderer.invoke("yunqi-db:stats"),
    top: (params) => ipcRenderer.invoke("yunqi-db:top", params),
    info: () => ipcRenderer.invoke("yunqi-db:info"),
    syncOnline: (params) => ipcRenderer.invoke("yunqi-db:sync-online", params),
  },

  // 每次调用前显式切到对应 profile，保证普通版/GPT 版不会串用生图凭证。
  imageStudio: createImageStudioApi("default"),
  imageStudioGpt: createImageStudioApi("gpt"),

  erp: {
    getStatus: () => ipcRenderer.invoke("erp:get-status"),
    runMigrations: () => ipcRenderer.invoke("erp:run-migrations"),
    getEnums: () => ipcRenderer.invoke("erp:get-enums"),
    client: {
      getStatus: () => ipcRenderer.invoke("erp:client:get-status"),
      setHostMode: () => ipcRenderer.invoke("erp:client:set-host-mode"),
      setClientMode: (payload) => ipcRenderer.invoke("erp:client:set-client-mode", payload || {}),
      discover: (payload) => ipcRenderer.invoke("erp:client:discover", payload || {}),
    },
    auth: {
      getStatus: () => ipcRenderer.invoke("erp:auth:get-status"),
      getCurrentUser: () => ipcRenderer.invoke("erp:auth:get-current-user"),
      createFirstAdmin: (payload) => ipcRenderer.invoke("erp:auth:create-first-admin", payload || {}),
      login: (payload) => ipcRenderer.invoke("erp:auth:login", payload || {}),
      logout: () => ipcRenderer.invoke("erp:auth:logout"),
    },
    company: {
      list: (params) => ipcRenderer.invoke("erp:company:list", params || {}),
      upsert: (payload) => ipcRenderer.invoke("erp:company:upsert", payload || {}),
    },
    account: {
      list: (params) => ipcRenderer.invoke("erp:account:list", params || {}),
      upsert: (payload) => ipcRenderer.invoke("erp:account:upsert", payload || {}),
      delete: (payload) => ipcRenderer.invoke("erp:account:delete", payload || {}),
    },
    user: {
      list: (params) => ipcRenderer.invoke("erp:user:list", params || {}),
      upsert: (payload) => ipcRenderer.invoke("erp:user:upsert", payload || {}),
    },
    permission: {
      getProfile: () => ipcRenderer.invoke("erp:permission:get-profile"),
      upsertRole: (payload) => ipcRenderer.invoke("erp:permission:upsert-role", payload || {}),
      upsertScope: (payload) => ipcRenderer.invoke("erp:permission:upsert-scope", payload || {}),
    },
    supplier: {
      list: (params) => ipcRenderer.invoke("erp:supplier:list", params || {}),
      create: (payload) => ipcRenderer.invoke("erp:supplier:create", payload || {}),
    },
    sku: {
      list: (params) => ipcRenderer.invoke("erp:sku:list", params || {}),
      create: (payload) => ipcRenderer.invoke("erp:sku:create", payload || {}),
      delete: (payload) => ipcRenderer.invoke("erp:sku:delete", payload || {}),
    },
    purchase: {
      workbench: (params) => ipcRenderer.invoke("erp:purchase:workbench", params || {}),
      action: (payload) => ipcRenderer.invoke("erp:purchase:action", payload || {}),
    },
    warehouse: {
      workbench: (params) => ipcRenderer.invoke("erp:warehouse:workbench", params || {}),
      action: (payload) => ipcRenderer.invoke("erp:warehouse:action", payload || {}),
    },
    qc: {
      workbench: (params) => ipcRenderer.invoke("erp:qc:workbench", params || {}),
      action: (payload) => ipcRenderer.invoke("erp:qc:action", payload || {}),
      decide: (payload) => ipcRenderer.invoke("erp:qc:decide", payload || {}),
    },
    outbound: {
      workbench: (params) => ipcRenderer.invoke("erp:outbound:workbench", params || {}),
      action: (payload) => ipcRenderer.invoke("erp:outbound:action", payload || {}),
    },
    workItem: {
      list: (params) => ipcRenderer.invoke("erp:workItem:list", params || {}),
      stats: (params) => ipcRenderer.invoke("erp:workItem:stats", params || {}),
      generate: (payload) => ipcRenderer.invoke("erp:workItem:generate", payload || {}),
      updateStatus: (payload) => ipcRenderer.invoke("erp:workItem:update-status", payload || {}),
    },
    workflow: {
      canTransition: (payload) => ipcRenderer.invoke("erp:workflow:can-transition", payload || {}),
      transition: (payload) => ipcRenderer.invoke("erp:workflow:transition", payload || {}),
    },
    lan: {
      getStatus: () => ipcRenderer.invoke("erp:lan:get-status"),
      start: (payload) => ipcRenderer.invoke("erp:lan:start", payload || {}),
      stop: () => ipcRenderer.invoke("erp:lan:stop"),
    },
    events: {
      onPurchaseUpdate: (handler) => {
        const listener = (_event, payload) => handler(payload);
        const releaseSubscription = retainErpEventSubscription();
        ipcRenderer.on("erp:purchase:update", listener);
        return () => {
          ipcRenderer.removeListener("erp:purchase:update", listener);
          releaseSubscription();
        };
      },
      onUserUpdate: (handler) => {
        const listener = (_event, payload) => handler(payload);
        const releaseSubscription = retainErpEventSubscription();
        ipcRenderer.on("erp:user:update", listener);
        return () => {
          ipcRenderer.removeListener("erp:user:update", listener);
          releaseSubscription();
        };
      },
      onAuthExpired: (handler) => {
        const listener = (_event, payload) => handler(payload);
        const releaseSubscription = retainErpEventSubscription();
        ipcRenderer.on("erp:auth:expired", listener);
        return () => {
          ipcRenderer.removeListener("erp:auth:expired", listener);
          releaseSubscription();
        };
      },
    },
  },

  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
    getUpdateStatus: () => ipcRenderer.invoke("app:get-update-status"),
    checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
    downloadUpdate: () => ipcRenderer.invoke("app:download-update"),
    quitAndInstallUpdate: () => ipcRenderer.invoke("app:quit-and-install-update"),
    openLogDirectory: () => ipcRenderer.invoke("app:open-log-directory"),
    openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
    readWorkflowPackLogs: (params) => ipcRenderer.invoke("app:read-workflow-pack-logs", params || {}),
    clearWorkflowPackLogs: () => ipcRenderer.invoke("app:clear-workflow-pack-logs"),
  },

  onAutomationEvent: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("automation-event", listener);
    return () => ipcRenderer.removeListener("automation-event", listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  },
  onImageStudioEvent: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("image-studio:event", listener);
    return () => ipcRenderer.removeListener("image-studio:event", listener);
  },

  priceReview: {
    scanNow: (params) => ipcRenderer.invoke("price-review:scan-now", params || {}),
    list: (params) => ipcRenderer.invoke("price-review:list", params || {}),
    setManualCost: (skuId, cost) => ipcRenderer.invoke("price-review:set-manual-cost", { skuId, cost }),
    clearManualCost: (skuId) => ipcRenderer.invoke("price-review:clear-manual-cost", { skuId }),
    open1688Login: (profilePath) => ipcRenderer.invoke("price-review:open-1688-login", { profilePath }),
    restartScheduler: () => ipcRenderer.invoke("price-review:restart-scheduler"),
    onAutoScanDone: (callback) => {
      const listener = (_, data) => callback(data);
      ipcRenderer.on("price-review:auto-scan-done", listener);
      return () => ipcRenderer.removeListener("price-review:auto-scan-done", listener);
    },
    onScanDone: (callback) => {
      const listener = (_, data) => callback(data);
      ipcRenderer.on("price-review:scan-done", listener);
      return () => ipcRenderer.removeListener("price-review:scan-done", listener);
    },
  },

  store: {
    get: (key) => ipcRenderer.invoke("store:get", key),
    getMany: (keys) => ipcRenderer.invoke("store:get-many", Array.isArray(keys) ? keys : []),
    set: (key, data) => {
      // 先 JSON roundtrip 清除不可序列化的内容（Buffer、circular ref 等），避免 IPC 结构化克隆失败
      try {
        const safe = JSON.parse(JSON.stringify(data));
        return ipcRenderer.invoke("store:set", key, safe);
      } catch (e) {
        console.error("[preload] store:set serialize error for key=" + key, e.message);
        return ipcRenderer.invoke("store:set", key, null);
      }
    },
    setMany: (entries) => {
      try {
        const safe = JSON.parse(JSON.stringify(entries && typeof entries === "object" ? entries : {}));
        return ipcRenderer.invoke("store:set-many", safe);
      } catch (e) {
        console.error("[preload] store:setMany serialize error", e.message);
        return ipcRenderer.invoke("store:set-many", {});
      }
    },
  },
});
