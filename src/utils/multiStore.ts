export const ACCOUNT_STORE_KEY = "temu_accounts";
export const ACTIVE_ACCOUNT_ID_KEY = "temu_active_account_id";
export const ACTIVE_ACCOUNT_CHANGED_EVENT = "temu:active-account-changed";
export const STORE_VALUE_UPDATED_EVENT = "temu:store-value-updated";
export const STORE_VALUES_UPDATED_EVENT = "temu:store-values-updated";

export interface MultiStoreAccount {
  id: string;
  name: string;
  ownerName?: string;
  phone?: string;
  password?: string;
  status?: "online" | "offline" | "logging_in" | "error";
  lastLoginAt?: string;
}

export const ACCOUNT_SCOPED_BASE_KEYS = [
  "temu_collection_diagnostics",
  "temu_create_history",
  "temu_dashboard",
  "temu_products",
  "temu_orders",
  "temu_sales",
  "temu_raw_salesChart",
  "temu_flux",
  "temu_flux_history",
  "temu_flux_product_history_cache",
  "temu_raw_goodsData",
  "temu_raw_lifecycle",
  "temu_raw_yunduOverall",
  "temu_raw_globalPerformance",
  "temu_raw_yunduActivityList",
  "temu_raw_yunduQualityMetrics",
  "temu_raw_imageTask",
  "temu_raw_sampleManage",
  "temu_raw_activity",
  "temu_raw_activityLog",
  "temu_raw_activityUS",
  "temu_raw_activityEU",
  "temu_raw_chanceGoods",
  "temu_raw_marketingActivity",
  "temu_raw_urgentOrders",
  "temu_raw_shippingDesk",
  "temu_raw_shippingList",
  "temu_raw_addressManage",
  "temu_raw_returnOrders",
  "temu_raw_returnDetail",
  "temu_raw_salesReturn",
  "temu_raw_returnReceipt",
  "temu_raw_exceptionNotice",
  "temu_raw_afterSales",
  "temu_raw_soldout",
  "temu_raw_performance",
  "temu_raw_checkup",
  "temu_raw_qualityDashboard",
  "temu_raw_qualityDashboardEU",
  "temu_raw_qcDetail",
  "temu_raw_priceReport",
  "temu_raw_priceCompete",
  "temu_raw_flowPrice",
  "temu_raw_retailPrice",
  "temu_raw_mallFlux",
  "temu_raw_mallFluxEU",
  "temu_raw_mallFluxUS",
  "temu_raw_fluxEU",
  "temu_raw_fluxUS",
  "temu_raw_flowGrow",
  "temu_raw_governDashboard",
  "temu_raw_governProductQualification",
  "temu_raw_governQualificationAppeal",
  "temu_raw_governEprQualification",
  "temu_raw_governProductPhoto",
  "temu_raw_governComplianceInfo",
  "temu_raw_governResponsiblePerson",
  "temu_raw_governManufacturer",
  "temu_raw_governComplaint",
  "temu_raw_governViolationAppeal",
  "temu_raw_governMerchantAppeal",
  "temu_raw_governTro",
  "temu_raw_governEprBilling",
  "temu_raw_governComplianceReference",
  "temu_raw_governCustomsAttribute",
  "temu_raw_governCategoryCorrection",
  "temu_raw_delivery",
  "temu_raw_adsHome",
  "temu_raw_adsProduct",
  "temu_raw_adsReport",
  "temu_raw_adsFinance",
  "temu_raw_adsHelp",
  "temu_raw_adsNotification",
  "temu_raw_usRetrieval",
  "temu_competitor_keywords",
  "temu_competitor_keyword_pool",
  "temu_competitor_tracked",
  "temu_competitor_reports",
  "temu_collection_cloud_upload_status",
  "temu_skc_summary",
] as const;

type StoreLike = {
  get: (key: string) => Promise<any>;
  getMany?: (keys: string[]) => Promise<Record<string, any>>;
  set: (key: string, value: any) => Promise<any>;
  setMany?: (entries: Record<string, any>) => Promise<any>;
} | undefined;

type StoreUpdateDetail = {
  baseKey?: string | null;
  baseKeys?: string[] | null;
  accountId?: string | null;
} | null | undefined;

export function buildScopedStoreKey(accountId: string, baseKey: string) {
  return `temu_store:${accountId}:${baseKey}`;
}

export function getPreferredActiveAccount(accounts: MultiStoreAccount[], activeAccountId?: string | null) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  if (activeAccountId) {
    const explicit = accounts.find((account) => account.id === activeAccountId);
    if (explicit) return explicit;
  }
  return (
    accounts.find((account) => account.status === "online") ||
    accounts.find((account) => account.status === "logging_in") ||
    accounts[0] ||
    null
  );
}

export async function readActiveAccountId(store: StoreLike) {
  if (!store) return null;
  const value = await store.get(ACTIVE_ACCOUNT_ID_KEY);
  return typeof value === "string" && value.trim() ? value : null;
}

export async function writeActiveAccountId(store: StoreLike, accountId: string | null) {
  if (!store) return;
  await store.set(ACTIVE_ACCOUNT_ID_KEY, accountId || null);
}

export function emitActiveAccountChanged(accountId: string | null) {
  window.dispatchEvent(
    new CustomEvent(ACTIVE_ACCOUNT_CHANGED_EVENT, {
      detail: { accountId: accountId || null },
    }),
  );
}

export function emitStoreValueUpdated(baseKey: string, accountId: string | null = null) {
  window.dispatchEvent(
    new CustomEvent(STORE_VALUE_UPDATED_EVENT, {
      detail: {
        baseKey,
        accountId: accountId || null,
      },
    }),
  );
}

export function emitStoreValuesUpdated(baseKeys: readonly string[], accountId: string | null = null) {
  const nextKeys = Array.from(new Set(baseKeys.map((key) => String(key || "").trim()).filter(Boolean)));
  if (nextKeys.length === 0) return;
  window.dispatchEvent(
    new CustomEvent(STORE_VALUES_UPDATED_EVENT, {
      detail: {
        baseKeys: nextKeys,
        accountId: accountId || null,
      },
    }),
  );
}

export function storeUpdateTouchesKeys(detail: StoreUpdateDetail, keys: readonly string[]) {
  if (!detail) return false;
  const targetKeys = new Set(keys);
  if (detail.baseKey && targetKeys.has(detail.baseKey)) return true;
  if (Array.isArray(detail.baseKeys)) {
    return detail.baseKeys.some((key) => targetKeys.has(key));
  }
  return false;
}

export async function syncScopedDataToGlobalStore(store: StoreLike, accountId: string | null) {
  if (!store) return;

  if (!accountId) {
    const emptyEntries = Object.fromEntries(
      ACCOUNT_SCOPED_BASE_KEYS.map((baseKey) => [baseKey, null]),
    );
    if (store.setMany) {
      await store.setMany(emptyEntries);
    } else {
      for (const baseKey of ACCOUNT_SCOPED_BASE_KEYS) {
        await store.set(baseKey, null);
      }
    }
    return;
  }

  const scopedKeys = ACCOUNT_SCOPED_BASE_KEYS.map((baseKey) => buildScopedStoreKey(accountId, baseKey));
  const scopedValues = store.getMany
    ? await store.getMany(scopedKeys)
    : Object.fromEntries(
        await Promise.all(
          scopedKeys.map(async (key) => [key, await store.get(key)] as const),
        ),
      );
  const nextEntries = Object.fromEntries(
    ACCOUNT_SCOPED_BASE_KEYS.map((baseKey) => {
      const scopedKey = buildScopedStoreKey(accountId, baseKey);
      return [baseKey, scopedValues?.[scopedKey] ?? null];
    }),
  );

  if (store.setMany) {
    await store.setMany(nextEntries);
  } else {
    for (const [baseKey, value] of Object.entries(nextEntries)) {
      await store.set(baseKey, value);
    }
  }
}

export async function setActiveAccountAndSync(store: StoreLike, accounts: MultiStoreAccount[], accountId?: string | null) {
  const activeAccount = getPreferredActiveAccount(accounts, accountId);
  const nextId = activeAccount?.id || null;
  const previousId = await readActiveAccountId(store);
  await writeActiveAccountId(store, nextId);
  await syncScopedDataToGlobalStore(store, nextId);
  if (previousId !== nextId) {
    emitActiveAccountChanged(nextId);
  }
  return nextId;
}

export async function setStoreValueForActiveAccount(
  store: StoreLike,
  baseKey: string,
  value: any,
  options?: { emit?: boolean },
) {
  if (!store) return;
  const shouldEmit = options?.emit !== false;

  if (!ACCOUNT_SCOPED_BASE_KEYS.includes(baseKey as typeof ACCOUNT_SCOPED_BASE_KEYS[number])) {
    await store.set(baseKey, value);
    if (shouldEmit) emitStoreValueUpdated(baseKey, null);
    return;
  }

  const activeAccountId = await readActiveAccountId(store);
  if (!activeAccountId) {
    await store.set(baseKey, value);
    if (shouldEmit) emitStoreValueUpdated(baseKey, null);
    return;
  }

  const scopedKey = buildScopedStoreKey(activeAccountId, baseKey);
  if (store.setMany) {
    await store.setMany({
      [baseKey]: value,
      [scopedKey]: value,
    });
  } else {
    await store.set(baseKey, value);
    await store.set(scopedKey, value);
  }
  if (shouldEmit) emitStoreValueUpdated(baseKey, activeAccountId);
}
