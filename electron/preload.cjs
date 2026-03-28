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
    autoPricing: (params) =>
      ipcRenderer.invoke("automation:auto-pricing", params),
    getProgress: () =>
      ipcRenderer.invoke("automation:get-progress"),
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
    pausePricing: () =>
      ipcRenderer.invoke("automation:pause-pricing"),
    resumePricing: () =>
      ipcRenderer.invoke("automation:resume-pricing"),
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

  onAutomationEvent: (callback) => {
    ipcRenderer.on("automation-event", (_, data) => callback(data));
  },

  store: {
    get: (key) => ipcRenderer.invoke("store:get", key),
    set: (key, data) => ipcRenderer.invoke("store:set", key, data),
  },
});
