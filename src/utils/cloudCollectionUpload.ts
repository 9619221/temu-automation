import {
  ACCOUNT_STORE_KEY,
  buildScopedStoreKey,
  readActiveAccountId,
  setStoreValueForActiveAccount,
  type MultiStoreAccount,
} from "./multiStore";
import { COLLECTION_DIAGNOSTICS_KEY, type CollectionDiagnostics } from "./collectionDiagnostics";
import { buildSkcUploadSummary, SKC_STORE_KEYS, SKC_SUMMARY_SOURCE_KEY } from "./storeSkcDashboard";

export const COLLECTION_CLOUD_UPLOAD_STATUS_KEY = "temu_collection_cloud_upload_status";

const EXTRA_COLLECTION_UPLOAD_KEYS = [
  "temu_flux_history",
  "temu_flux_product_history_cache",
] as const;

export interface CollectTaskUploadDescriptor {
  key: string;
  label: string;
  storeKey: string;
  category: string;
}

type StoreLike = NonNullable<typeof window.electronAPI>["store"] | undefined;

function safeJsonStringify(value: any) {
  try {
    return JSON.stringify(value === undefined ? null : value);
  } catch {
    return "null";
  }
}

function inferRecordCount(value: any) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value.items)) return value.items.length;
  if (Array.isArray(value.list)) return value.list.length;
  if (Array.isArray(value.data)) return value.data.length;
  if (Array.isArray(value.apis)) return value.apis.length;
  if (value.result && typeof value.result === "object") {
    if (Array.isArray(value.result.items)) return value.result.items.length;
    if (Array.isArray(value.result.list)) return value.result.list.length;
    if (Array.isArray(value.result.data)) return value.result.data.length;
  }
  return 0;
}

function payloadBytes(value: any) {
  return new Blob([safeJsonStringify(value)]).size;
}

async function readValuesForAccount(store: StoreLike, accountId: string, baseKeys: string[]): Promise<Record<string, any>> {
  if (!store) return {};
  const scopedKeys = baseKeys.map((key) => buildScopedStoreKey(accountId, key));
  const allKeys = Array.from(new Set([...baseKeys, ...scopedKeys]));
  const values = store.getMany
    ? await store.getMany(allKeys)
    : Object.fromEntries(
        await Promise.all(allKeys.map(async (key) => [key, await store.get(key)] as const)),
      );

  return Object.fromEntries(
    baseKeys.map((key) => {
      const scopedKey = buildScopedStoreKey(accountId, key);
      const scopedValue = values?.[scopedKey];
      return [key, scopedValue !== null && scopedValue !== undefined ? scopedValue : (values?.[key] ?? null)];
    }),
  );
}

function uniqueKeys(keys: string[]) {
  return Array.from(new Set(keys.map((key) => String(key || "").trim()).filter(Boolean)));
}

const NON_UPLOAD_STORE_NAME_PATTERNS = [
  /^(?:\u5fd8\u8bb0\u5bc6\u7801|\u627e\u56de\u5bc6\u7801|\u767b\u5f55|\u767b\u9304|\u6ce8\u518c|\u9a8c\u8bc1\u7801|Forgot Password|Reset Password|Login|Log In|Sign In|Register|Verification Code)$/i,
  /^(?:\u521b\u5efa\u65b0\u5e97\u94fa.*|\u5408\u89c4\u767b\u8bb0(?:\u53ca)?\u9a8c\u8bc1.*|0\u5143\u5f00\u5e97|\u514d\u8d39\u5f00\u5e97|\u6211\u8981\u5f00\u5e97|\u7acb\u5373\u5f00\u5e97|\u53bb\u5f00\u5e97)$/u,
  /^(?:\u9690\u79c1\u653f\u7b56|\u9690\u79c1\u6761\u6b3e|\u7528\u6237\u534f\u8bae|\u670d\u52a1\u6761\u6b3e|\u6cd5\u5f8b\u58f0\u660e|\u5173\u4e8e\u6211\u4eec|\u8054\u7cfb\u6211\u4eec)$/u,
  /^(0元开店|免费开店|我要开店|立即开店|去开店|未识别店铺|采集快照)$/i,
  /(开店|入驻|注册|登录|退出|刷新|通知|日志|设置|账号|业务|数据|管理|全部|搜索|验证码)/i,
  /(店铺控制台|采集|巡店|帮助|教程|下载|升级|活动报名)/i,
  /(隐私政策|隐私条款|用户协议|服务条款|法律声明|Privacy Policy|Cookie Policy|Terms of Use|Terms & Conditions|Legal Notice|About Us|Contact Us)/i,
];

function normalizeUploadStoreName(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[>›].*$/, "")
    .replace(/\s*(?:\u5207\u6362\u5e97\u94fa|\u5e97\u94fa\u5207\u6362|\u5207\u6362)\s*$/u, "")
    .replace(/\s*(?:Switch Store|Switch)\s*$/i, "")
    .trim();
}

function isReliableUploadStoreName(value: unknown) {
  const text = normalizeUploadStoreName(value);
  if (text.length < 3 || text.length > 80) return false;
  if (/^temu_ext_[a-f0-9]+$/i.test(text)) return false;
  if (/^acct[_:-]/i.test(text)) return false;
  if (/^\+?\d[\d\s*()-]{3,}$/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return false;
  if (NON_UPLOAD_STORE_NAME_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return true;
}

export async function uploadCurrentCollectionToCloud(options: {
  tasks: readonly CollectTaskUploadDescriptor[];
  diagnostics: CollectionDiagnostics;
  collectedAt: string;
  collectedAtIso: string;
}) {
  const erp = window.electronAPI?.erp;
  const store = window.electronAPI?.store;
  if (!erp?.storeCollection?.upload) throw new Error("ERP cloud upload API is not available");
  if (!store) throw new Error("Local store is not available");

  const accountId = await readActiveAccountId(store);
  if (!accountId) throw new Error("No active store account selected");

  const rawAccounts = await store.get(ACCOUNT_STORE_KEY);
  const accounts = Array.isArray(rawAccounts) ? rawAccounts as MultiStoreAccount[] : [];
  const account = accounts.find((item) => item.id === accountId) || null;
  const storeName = normalizeUploadStoreName(account?.name);
  if (!isReliableUploadStoreName(storeName)) {
    throw new Error("当前店铺名称不可靠，已拒绝上传巡店快照。请先在店铺管理里绑定真实店铺名称。");
  }
  const ownerName = account?.ownerName || "";
  const taskByStoreKey = new Map(options.tasks.map((task) => [task.storeKey, task]));
  const sourceKeys = uniqueKeys([
    COLLECTION_DIAGNOSTICS_KEY,
    ...options.tasks.map((task) => task.storeKey),
    ...EXTRA_COLLECTION_UPLOAD_KEYS,
    ...SKC_STORE_KEYS,
  ]);
  const values = await readValuesForAccount(store, accountId, sourceKeys);
  values[COLLECTION_DIAGNOSTICS_KEY] = options.diagnostics;

  const sources = sourceKeys
    .map((dataKey) => {
      const payload = values[dataKey];
      if (payload === null || payload === undefined) return null;
      const task = taskByStoreKey.get(dataKey);
      return {
        dataKey,
        taskKey: task?.key || (dataKey === COLLECTION_DIAGNOSTICS_KEY ? "collectionDiagnostics" : dataKey),
        label: task?.label || (dataKey === COLLECTION_DIAGNOSTICS_KEY ? "采集诊断" : dataKey),
        category: task?.category || "采集元数据",
        recordCount: inferRecordCount(payload),
        payloadBytes: payloadBytes(payload),
        payload,
      };
    })
    .filter((source): source is {
      dataKey: string;
      taskKey: string;
      label: string;
      category: string;
      recordCount: number;
      payloadBytes: number;
      payload: any;
    } => Boolean(source));

  const skcSummary = buildSkcUploadSummary({
    accountId,
    storeName,
    ownerName,
    generatedAt: options.collectedAtIso || new Date().toISOString(),
    values,
  });
  sources.push({
    dataKey: SKC_SUMMARY_SOURCE_KEY,
    taskKey: "skcSummary",
    label: "SKC 数据摘要",
    category: "SKC摘要",
    recordCount: skcSummary.rows.length,
    payloadBytes: payloadBytes(skcSummary),
    payload: skcSummary,
  });
  await setStoreValueForActiveAccount(store, SKC_SUMMARY_SOURCE_KEY, skcSummary);

  if (sources.length === 0) throw new Error("No collection data to upload");

  const snapshot = await erp.storeCollection.upload({
    accountId,
    storeName,
    ownerName,
    collectedAt: options.collectedAtIso || options.collectedAt,
    collectedAtIso: options.collectedAtIso,
    clientSnapshotId: `${accountId}:${options.collectedAtIso || options.collectedAt}`,
    diagnostics: options.diagnostics as unknown as Record<string, any>,
    summary: options.diagnostics.summary as unknown as Record<string, any>,
    manifest: {
      version: 1,
      source: "temu-automation-client",
      collectedAt: options.collectedAt,
      collectedAtIso: options.collectedAtIso,
      sourceCount: sources.length,
    },
    sources: sources as any,
  });

  await setStoreValueForActiveAccount(store, COLLECTION_CLOUD_UPLOAD_STATUS_KEY, {
    status: "success",
    snapshotId: snapshot?.id || null,
    uploadedAt: new Date().toISOString(),
    collectedAt: options.collectedAt,
    collectedAtIso: options.collectedAtIso,
    sourceCount: sources.length,
    payloadBytes: snapshot?.payloadBytes || sources.reduce((sum: number, source: any) => sum + (source.payloadBytes || 0), 0),
  });

  return snapshot;
}

export async function persistCollectionUploadError(error: any, collectedAt: string, collectedAtIso: string) {
  const store = window.electronAPI?.store;
  if (!store) return;
  await setStoreValueForActiveAccount(store, COLLECTION_CLOUD_UPLOAD_STATUS_KEY, {
    status: "error",
    uploadedAt: new Date().toISOString(),
    collectedAt,
    collectedAtIso,
    error: error?.message || String(error),
  });
}
