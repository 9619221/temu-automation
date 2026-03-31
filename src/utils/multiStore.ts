export const ACCOUNT_STORE_KEY = "temu_accounts";
export const ACTIVE_ACCOUNT_ID_KEY = "temu_active_account_id";
export const ACTIVE_ACCOUNT_CHANGED_EVENT = "temu:active-account-changed";

export interface MultiStoreAccount {
  id: string;
  name: string;
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
  "temu_flux",
  "temu_task_manager_state",
  "temu_raw_goodsData",
  "temu_raw_lifecycle",
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
] as const;

type StoreLike = {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<any>;
} | undefined;

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

export async function syncScopedDataToGlobalStore(store: StoreLike, accountId: string | null) {
  if (!store) return;

  if (!accountId) {
    for (const baseKey of ACCOUNT_SCOPED_BASE_KEYS) {
      await store.set(baseKey, null);
    }
    return;
  }

  const scopedEntries: Array<readonly [string, any]> = [];
  for (const baseKey of ACCOUNT_SCOPED_BASE_KEYS) {
    const value = await store.get(buildScopedStoreKey(accountId, baseKey));
    scopedEntries.push([baseKey, value ?? null] as const);
  }

  for (const [baseKey, value] of scopedEntries) {
    await store.set(baseKey, value);
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

export async function setStoreValueForActiveAccount(store: StoreLike, baseKey: string, value: any) {
  if (!store) return;

  await store.set(baseKey, value);
  if (!ACCOUNT_SCOPED_BASE_KEYS.includes(baseKey as typeof ACCOUNT_SCOPED_BASE_KEYS[number])) {
    return;
  }

  const activeAccountId = await readActiveAccountId(store);
  if (!activeAccountId) return;

  await store.set(buildScopedStoreKey(activeAccountId, baseKey), value);
}
