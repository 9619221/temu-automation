const { contextBridge, ipcRenderer } = require("electron");

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
    createProduct: (params) =>
      ipcRenderer.invoke("automation:create-product", params),
    filterProductTable: (csvPath) =>
      ipcRenderer.invoke("automation:filter-product-table", csvPath),
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

  imageStudio: {
    getStatus: () => ipcRenderer.invoke("image-studio:get-status"),
    ensureRunning: () => ipcRenderer.invoke("image-studio:ensure-running"),
    restart: () => ipcRenderer.invoke("image-studio:restart"),
    openExternal: () => ipcRenderer.invoke("image-studio:open-external"),
    getConfig: () => ipcRenderer.invoke("image-studio:get-config"),
    updateConfig: (payload) => ipcRenderer.invoke("image-studio:update-config", payload),
    analyze: (payload) => ipcRenderer.invoke("image-studio:analyze", payload),
    regenerateAnalysis: (payload) => ipcRenderer.invoke("image-studio:regenerate-analysis", payload),
    generatePlans: (payload) => ipcRenderer.invoke("image-studio:generate-plans", payload),
    startGenerate: (payload) => ipcRenderer.invoke("image-studio:start-generate", payload),
    cancelGenerate: (jobId) => ipcRenderer.invoke("image-studio:cancel-generate", jobId),
    listHistory: () => ipcRenderer.invoke("image-studio:list-history"),
    getHistoryItem: (id) => ipcRenderer.invoke("image-studio:get-history-item", id),
    saveHistory: (payload) => ipcRenderer.invoke("image-studio:save-history", payload),
    scoreImage: (payload) => ipcRenderer.invoke("image-studio:score-image", payload),
    listJobs: () => ipcRenderer.invoke("image-studio:list-jobs"),
    getJob: (jobId) => ipcRenderer.invoke("image-studio:get-job", jobId),
    clearJob: (jobId) => ipcRenderer.invoke("image-studio:clear-job", jobId),
  },

  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
    getUpdateStatus: () => ipcRenderer.invoke("app:get-update-status"),
    checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
    downloadUpdate: () => ipcRenderer.invoke("app:download-update"),
    quitAndInstallUpdate: () => ipcRenderer.invoke("app:quit-and-install-update"),
    openLogDirectory: () => ipcRenderer.invoke("app:open-log-directory"),
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

  store: {
    get: (key) => ipcRenderer.invoke("store:get", key),
    set: (key, data) => ipcRenderer.invoke("store:set", key, data),
  },
});
