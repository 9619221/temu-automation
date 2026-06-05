export const ERP_CLOUD_SERVER_REGION = "HK";
// 默认连 HK 云端；本地开发可设 VITE_ERP_SERVER_URL 覆盖（如指向本机 erp-server 做联调）。
// 未设环境变量时一律回退生产云端，因此即使此写法被提交、打包发版也不受影响。
const ENV_ERP_SERVER_URL = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_ERP_SERVER_URL;
export const ERP_CLOUD_SERVER_URL = (typeof ENV_ERP_SERVER_URL === "string" && ENV_ERP_SERVER_URL)
  ? ENV_ERP_SERVER_URL
  : "https://erp.temu.chat";
export const ERP_CLOUD_SERVER_LABEL = "HK 主控端";
