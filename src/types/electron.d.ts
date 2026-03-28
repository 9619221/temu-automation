interface AutomationAPI {
  launch: (accountId: string, headless?: boolean) => Promise<{ status: string }>;
  login: (accountId: string, email: string, password: string) => Promise<{ success: boolean }>;
  scrapeProducts: () => Promise<{ products: ScrapedProduct[] }>;
  scrapeOrders: () => Promise<{ orders: ScrapedOrder[] }>;
  scrapeSales: () => Promise<{ sales: { summary: any; items: any[] } }>;
  scrapeFlux: () => Promise<{ flux: { mallSummary: any; goods: any[] } }>;
  scrapeDashboard: () => Promise<{ dashboard: any }>;
  scrapeAfterSales: () => Promise<{ afterSales: any[] }>;
  scrapeSoldOut: () => Promise<{ soldOut: any }>;
  scrapeGoodsData: () => Promise<{ goodsData: any }>;
  scrapeActivity: () => Promise<{ activity: any }>;
  scrapePerformance: () => Promise<{ performance: any }>;
  scrapeAll: () => Promise<any>;
  readScrapeData: (key: string) => Promise<any>;
  scrapeLifecycle: () => Promise<any>;
  scrapeBidding: () => Promise<any>;
  scrapePriceCompete: () => Promise<any>;
  scrapeHotPlan: () => Promise<any>;
  scrapeCheckup: () => Promise<any>;
  scrapeUSRetrieval: () => Promise<any>;
  scrapeDelivery: () => Promise<any>;
  createProduct: (params: any) => Promise<any>;
  batchCreateFromCsv: (params: any) => Promise<any>;
  autoPricing: (params: { csvPath: string; startRow?: number; count?: number }) => Promise<any>;
  close: () => Promise<{ status: string }>;
  ping: () => Promise<{ status: string }>;
}

interface ScrapedProduct {
  temuProductId?: string;
  title: string;
  sku: string;
  price: number;
  stock: number;
  status: string;
  category?: string;
  imageUrl?: string;
}

interface ScrapedOrder {
  orderId: string;
  productTitle: string;
  quantity: number;
  amount: number;
  status: string;
  orderTime: string;
}

interface StoreAPI {
  get: (key: string) => Promise<any>;
  set: (key: string, data: any) => Promise<boolean>;
}

interface ElectronAPI {
  getAppPath: () => Promise<string>;
  automation: AutomationAPI;
  store: StoreAPI;
  onAutomationEvent: (callback: (data: any) => void) => void;
  onAutomationLog: (callback: (data: string) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
