import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tag, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { canRole } from "../utils/erpUi";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";

const erp = window.electronAPI?.erp;
const STORE_MANAGER_CACHE_KEY = "temu.store-manager.cache.v1";
const ADDRESS_WORKBENCH_PARAMS = {
  limit: 20,
  includeRequestDetails: false,
  includeOptions: false,
  include1688Meta: true,
};

interface StoreAccountRow {
  id: string;
  name: string;
  phone?: string | null;
  status?: string;
  source?: string;
  alibaba1688AddressId?: string | null;
  alibaba1688AddressLabel?: string | null;
  alibaba1688FullName?: string | null;
  alibaba1688Mobile?: string | null;
  alibaba1688Phone?: string | null;
  alibaba1688PostCode?: string | null;
  alibaba1688ProvinceText?: string | null;
  alibaba1688CityText?: string | null;
  alibaba1688AreaText?: string | null;
  alibaba1688TownText?: string | null;
  alibaba1688Address?: string | null;
  alibaba1688AddressRemoteId?: string | null;
  default1688PurchaseAccountId?: string | null;
}

interface Purchase1688AccountRow {
  id: string;
  label?: string | null;
  appKey?: string;
  memberId?: string | null;
  status?: string;
  configured?: boolean;
  authorized?: boolean;
}

interface Alibaba1688AddressRow {
  id: string;
  label?: string | null;
  fullName?: string | null;
  mobile?: string | null;
  phone?: string | null;
  postCode?: string | null;
  provinceText?: string | null;
  cityText?: string | null;
  areaText?: string | null;
  townText?: string | null;
  address?: string | null;
  addressId?: string | null;
  rawAddressParam?: Record<string, any> | null;
  addressParam?: Record<string, any> | null;
}

interface StoreAddressValues {
  selected1688AddressId?: string;
  alibabaAddressId?: string;
  label: string;
  fullName: string;
  mobile?: string;
  phone?: string;
  postCode?: string;
  provinceText?: string;
  cityText?: string;
  areaText?: string;
  townText?: string;
  address: string;
}

interface TemuOpenApiBinding {
  mallId: string;
  mallName: string;
  region: string;
  appKey?: string;
  authorized: boolean;
  semiManaged?: boolean;
  scopeCount: number;
  accessTokenExpiresAt: string;
  status: string;
  authorizedAt?: string;
  updatedAt?: string;
}

interface StoreManagerProps {
  onChanged?: () => void | Promise<void>;
}

interface StoreManagerCache {
  generatedAt?: string;
  accounts?: StoreAccountRow[];
  alibaba1688Addresses?: Alibaba1688AddressRow[];
  purchase1688Accounts?: Purchase1688AccountRow[];
}

function statusColor(status?: string) {
  switch (status) {
    case "active":
    case "online":
      return "success";
    case "blocked":
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    active: "启用",
    online: "在线",
    offline: "离线",
    blocked: "停用",
    deleted: "已删除",
  };
  return labels[status || ""] || status || "-";
}

function storeAddressSummary(row: StoreAccountRow) {
  return [row.alibaba1688ProvinceText, row.alibaba1688CityText, row.alibaba1688AreaText, row.alibaba1688Address]
    .filter(Boolean)
    .join("");
}

function getStoreAddressInitialValues(row: StoreAccountRow): StoreAddressValues {
  return {
    alibabaAddressId: row.alibaba1688AddressRemoteId || "",
    label: row.alibaba1688AddressLabel || `${row.name}地址`,
    fullName: row.alibaba1688FullName || "",
    mobile: row.alibaba1688Mobile || "",
    phone: row.alibaba1688Phone || "",
    postCode: row.alibaba1688PostCode || "",
    provinceText: row.alibaba1688ProvinceText || "",
    cityText: row.alibaba1688CityText || "",
    areaText: row.alibaba1688AreaText || "",
    townText: row.alibaba1688TownText || "",
    address: row.alibaba1688Address || "",
  };
}

function get1688AddressSummary(row: Alibaba1688AddressRow) {
  return [row.provinceText, row.cityText, row.areaText, row.address].filter(Boolean).join("");
}

function get1688AddressRows(value: any): Alibaba1688AddressRow[] {
  const rows = value?.alibaba1688Addresses
    || value?.workbench?.alibaba1688Addresses
    || value?.result?.addresses
    || value?.addresses;
  return Array.isArray(rows) ? rows as Alibaba1688AddressRow[] : [];
}

function firstAddressText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (!["string", "number", "boolean"].includes(typeof value)) return "";
  const text = String(value ?? "").trim();
  return text || "";
}

function findAddressValue(value: unknown, keys: string[], depth = 0): string {
  if (!value || depth > 6) return "";
  const keySet = new Set(keys.map((key) => key.toLowerCase()));
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAddressValue(item, keys, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
    if (keySet.has(key.toLowerCase())) {
      const text = firstAddressText(next);
      if (text) return text;
    }
  }
  for (const next of Object.values(value as Record<string, unknown>)) {
    const found = findAddressValue(next, keys, depth + 1);
    if (found) return found;
  }
  return "";
}

function addressValue(row: Alibaba1688AddressRow, ownValue: unknown, keys: string[]) {
  return (
    firstAddressText(ownValue)
    || findAddressValue(row.rawAddressParam, keys)
    || findAddressValue(row.addressParam, keys)
  );
}

const CHINA_PROVINCE_NAMES = [
  "北京市", "天津市", "上海市", "重庆市",
  "河北省", "山西省", "辽宁省", "吉林省", "黑龙江省",
  "江苏省", "浙江省", "安徽省", "福建省", "江西省", "山东省",
  "河南省", "湖北省", "湖南省", "广东省", "海南省", "四川省",
  "贵州省", "云南省", "陕西省", "甘肃省", "青海省", "台湾省",
  "内蒙古自治区", "广西壮族自治区", "西藏自治区", "宁夏回族自治区", "新疆维吾尔自治区",
  "香港特别行政区", "澳门特别行政区",
];

const CHINA_MUNICIPALITIES = new Set(["北京市", "天津市", "上海市", "重庆市"]);

function parseChineseRegionFromAddress(value: unknown) {
  const source = firstAddressText(value).replace(/\s+/g, " ").trim();
  const empty = { provinceText: "", cityText: "", areaText: "", address: "" };
  if (!source) return empty;

  const compact = source.replace(/\s+/g, "");
  let provinceText = "";
  let provinceIndex = -1;
  for (const province of CHINA_PROVINCE_NAMES) {
    const index = compact.indexOf(province);
    if (index >= 0 && (provinceIndex < 0 || index < provinceIndex)) {
      provinceText = province;
      provinceIndex = index;
    }
  }
  if (!provinceText) return empty;

  const rest = compact.slice(provinceIndex + provinceText.length);
  const match = rest.match(/^(.+?(?:自治州|地区|盟|市))?(.+?(?:区|县|市|旗))?/);
  const matchedCityText = match?.[1] || "";
  const areaText = match?.[2] || "";
  const cityText = matchedCityText || (CHINA_MUNICIPALITIES.has(provinceText) ? provinceText : "");
  let address = source;
  for (const part of [provinceText, matchedCityText, areaText].filter(Boolean)) {
    address = address.replace(part, "");
  }
  address = address.replace(/\s+/g, " ").trim();
  return { provinceText, cityText, areaText, address };
}

function get1688AddressFormValues(row: Alibaba1688AddressRow): Partial<StoreAddressValues> {
  const mobile = addressValue(row, row.mobile, [
    "mobile", "mobileNo", "mobileNumber", "mobilePhone", "phoneNumber", "phoneNum",
    "receiverMobile", "receiverMobileNo", "receiveMobile", "receiveMobileNo",
    "recipientMobile", "consigneeMobile", "contactMobile", "cellphone",
  ]);
  const rawProvinceText = addressValue(row, row.provinceText, ["provinceText", "provinceName", "province", "provName"]);
  const rawCityText = addressValue(row, row.cityText, ["cityText", "cityName", "city"]);
  const rawAreaText = addressValue(row, row.areaText, ["areaText", "areaName", "district", "districtName", "county", "countyName"]);
  const rawAddress = addressValue(row, row.address, [
    "address", "detailAddress", "addressDetail", "detailedAddress",
    "receiverAddress", "receiveAddress", "streetAddress", "fullAddress",
  ]);
  const parsedAddress = parseChineseRegionFromAddress(rawAddress);
  const parsedSummary = parseChineseRegionFromAddress([
    rawAddress,
    row.label,
    get1688AddressSummary(row),
  ].filter(Boolean).join(" "));
  return {
    selected1688AddressId: row.id,
    alibabaAddressId: addressValue(row, row.addressId, ["addressId", "addressID", "receiveAddressId", "receive_address_id", "id"]),
    label: row.label || "1688 地址",
    fullName: addressValue(row, row.fullName, ["fullName", "receiverName", "receiveName", "receiver", "consignee", "contactName", "name"]),
    mobile,
    phone: addressValue(row, row.phone, ["phone", "tel", "telephone", "receiverPhone", "receivePhone", "contactPhone"]),
    postCode: addressValue(row, row.postCode, ["postCode", "postcode", "postalCode", "zip", "zipCode", "post"]),
    provinceText: rawProvinceText || parsedAddress.provinceText || parsedSummary.provinceText,
    cityText: rawCityText || parsedAddress.cityText || parsedSummary.cityText,
    areaText: rawAreaText || parsedAddress.areaText || parsedSummary.areaText,
    townText: addressValue(row, row.townText, ["townText", "townName", "town", "streetName"]),
    address: parsedAddress.address || rawAddress,
  };
}

function buildStoreAddressPayload(values: StoreAddressValues, accountId: string, addressId?: string | null) {
  return {
    action: "save_1688_address",
    id: addressId || undefined,
    accountId,
    label: values.label,
    fullName: values.fullName,
    mobile: values.mobile,
    phone: values.phone,
    postCode: values.postCode,
    provinceText: values.provinceText,
    cityText: values.cityText,
    areaText: values.areaText,
    townText: values.townText,
    address: values.address,
    alibabaAddressId: values.alibabaAddressId,
    isDefault: true,
    status: "active",
    ...ADDRESS_WORKBENCH_PARAMS,
  };
}

function isDeleteAccountHandlerMissing(error: any) {
  return /deleteAccount is not defined/i.test(String(error?.message || error || ""));
}

export default function StoreManager({ onChanged }: StoreManagerProps) {
  const auth = useErpAuth();
  const role = auth.currentUser?.role;
  const canManageAccounts = canRole(role, ["admin", "manager"]);
  const canManageStoreAddress = canRole(role, ["admin", "manager", "buyer"]);
  const cachedData = useMemo(
    () => readPageCache<StoreManagerCache>(STORE_MANAGER_CACHE_KEY, {}),
    [],
  );

  const [accountForm] = Form.useForm();
  const [storeAddressForm] = Form.useForm<StoreAddressValues>();
  const [temuBindForm] = Form.useForm<{ accessToken: string; region: string; mallName?: string }>();
  const [accounts, setAccounts] = useState<StoreAccountRow[]>(() => cachedData.accounts || []);
  const [alibaba1688Addresses, setAlibaba1688Addresses] = useState<Alibaba1688AddressRow[]>(() => cachedData.alibaba1688Addresses || []);
  const [purchase1688Accounts, setPurchase1688Accounts] = useState<Purchase1688AccountRow[]>(() => cachedData.purchase1688Accounts || []);
  const [temuAccounts, setTemuAccounts] = useState<{ id: string; name: string }[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [accountCreateModalOpen, setAccountCreateModalOpen] = useState(false);
  const [storeAddressModalOpen, setStoreAddressModalOpen] = useState(false);
  const [editingStoreAddressAccount, setEditingStoreAddressAccount] = useState<StoreAccountRow | null>(null);
  const [temuBindings, setTemuBindings] = useState<TemuOpenApiBinding[]>([]);
  const [temuBindModalOpen, setTemuBindModalOpen] = useState(false);

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "zh-Hans-CN", { numeric: true }),
    ),
    [accounts],
  );
  const addressById = useMemo(
    () => new Map(alibaba1688Addresses.map((address) => [address.id, address])),
    [alibaba1688Addresses],
  );
  const alibaba1688AddressOptions = useMemo(
    () => alibaba1688Addresses.map((address) => ({
      label: [address.label, address.fullName, get1688AddressSummary(address)].filter(Boolean).join(" / ") || address.id,
      value: address.id,
    })),
    [alibaba1688Addresses],
  );

  const loadAll = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const [nextAccounts, purchaseWorkbench, purchase1688AccountsResult] = await Promise.all([
        erp.account.list({ limit: 500 }),
        erp.purchase.workbench(ADDRESS_WORKBENCH_PARAMS).catch(() => null),
        erp.purchase.action({ action: "list_1688_purchase_accounts" }).catch(() => null),
      ]);
      const nextAccountRows = Array.isArray(nextAccounts) ? nextAccounts as StoreAccountRow[] : [];
      setAccounts(nextAccountRows);
      const nextAddresses = get1688AddressRows(purchaseWorkbench);
      if (nextAddresses.length) setAlibaba1688Addresses(nextAddresses);
      const nextPurchase1688Accounts = Array.isArray(purchase1688AccountsResult?.result?.accounts)
        ? (purchase1688AccountsResult.result.accounts as Purchase1688AccountRow[])
        : [];
      setPurchase1688Accounts(nextPurchase1688Accounts);
      try {
        const store = window.electronAPI?.store;
        if (store) {
          const raw = await store.get("temu_accounts");
          const list = Array.isArray(raw) ? raw : [];
          setTemuAccounts(list.filter((a) => a && a.id).map((a) => ({ id: String(a.id), name: String(a.name || a.id) })));
        } else {
          setTemuAccounts([]);
        }
      } catch {
        setTemuAccounts([]);
      }
      setLoadedOnce(true);
      writePageCache<StoreManagerCache>(STORE_MANAGER_CACHE_KEY, {
        generatedAt: new Date().toISOString(),
        accounts: nextAccountRows,
        alibaba1688Addresses: nextAddresses.length ? nextAddresses : cachedData.alibaba1688Addresses,
        purchase1688Accounts: nextPurchase1688Accounts.length ? nextPurchase1688Accounts : cachedData.purchase1688Accounts,
      });
    } catch (error: any) {
      message.error(error?.message || "店铺读取失败");
    } finally {
      setLoading(false);
    }
  }, [cachedData.alibaba1688Addresses]);

  const notifyChanged = useCallback(async () => {
    await loadAll();
    await onChanged?.();
  }, [loadAll, onChanged]);

  const refresh1688Addresses = useCallback(async (syncIfEmpty = false) => {
    if (!erp) return [];
    setAddressLoading(true);
    try {
      const workbench = await erp.purchase.workbench(ADDRESS_WORKBENCH_PARAMS).catch(() => null);
      let nextAddresses = get1688AddressRows(workbench);
      if (!nextAddresses.length && syncIfEmpty) {
        const result = await erp.purchase.action({ action: "sync_1688_addresses", ...ADDRESS_WORKBENCH_PARAMS });
        nextAddresses = get1688AddressRows(result);
      }
      if (nextAddresses.length) {
        setAlibaba1688Addresses(nextAddresses);
        setLoadedOnce(true);
        writePageCache<StoreManagerCache>(STORE_MANAGER_CACHE_KEY, {
          generatedAt: new Date().toISOString(),
          accounts,
          alibaba1688Addresses: nextAddresses,
        });
      }
      return nextAddresses;
    } catch (error: any) {
      if (syncIfEmpty) message.error(error?.message || "1688 地址同步失败");
      return [];
    } finally {
      setAddressLoading(false);
    }
  }, [accounts]);

  const loadTemuBindings = useCallback(async () => {
    if (!erp?.temuOpenApi) return;
    try {
      const res = await erp.temuOpenApi.list();
      setTemuBindings(Array.isArray(res?.malls) ? res.malls : []);
    } catch {
      // 静默：未配置 / 无权限时不打扰
    }
  }, []);

  useEffect(() => {
    void loadAll();
    void loadTemuBindings();
  }, [loadAll, loadTemuBindings]);

  const handleBindTemuOpenApi = async () => {
    if (!erp?.temuOpenApi) return;
    const values = await temuBindForm.validateFields();
    setSubmitting("temu-openapi-bind");
    try {
      const binding = await erp.temuOpenApi.bind({
        accessToken: values.accessToken.trim(),
        region: values.region || "CN",
        mallName: values.mallName?.trim() || undefined,
      });
      message.success(`已绑定店铺 ${binding.mallName || binding.mallId}（${binding.scopeCount} 个接口权限）`);
      setTemuBindModalOpen(false);
      temuBindForm.resetFields();
      await loadTemuBindings();
    } catch (error: any) {
      message.error(error?.message || "绑定失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleUnbindTemuOpenApi = async (row: TemuOpenApiBinding) => {
    if (!erp?.temuOpenApi) return;
    setSubmitting(`temu-openapi-unbind:${row.mallId}`);
    try {
      await erp.temuOpenApi.unbind({ mallId: row.mallId });
      message.success("已解绑");
      await loadTemuBindings();
    } catch (error: any) {
      message.error(error?.message || "解绑失败");
    } finally {
      setSubmitting(null);
    }
  };

  const openCreateAccountModal = () => {
    accountForm.resetFields();
    accountForm.setFieldsValue({ label: "默认地址" });
    setAccountCreateModalOpen(true);
    if (!alibaba1688Addresses.length) void refresh1688Addresses(true);
  };

  const handleCreateAccount = async () => {
    if (!erp) return;
    const values = await accountForm.validateFields() as StoreAddressValues & { name: string; status?: string; temuAccountId?: string };
    setSubmitting("account");
    try {
      const account = await erp.account.upsert({
        ...(values.temuAccountId ? { id: String(values.temuAccountId) } : {}),
        name: values.name,
        status: values.status || "online",
        source: "purchase_center",
      });
      await erp.purchase.action(buildStoreAddressPayload(values, account.id));
      accountForm.resetFields();
      setAccountCreateModalOpen(false);
      message.success("店铺和 1688 地址已保存");
      await notifyChanged();
    } catch (error: any) {
      message.error(error?.message || "店铺保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const openStoreAddressModal = (row: StoreAccountRow) => {
    setEditingStoreAddressAccount(row);
    storeAddressForm.resetFields();
    const selectedAddress = alibaba1688Addresses.find((address) => (
      (row.alibaba1688AddressRemoteId && address.addressId === row.alibaba1688AddressRemoteId)
      || address.id === row.alibaba1688AddressId
    ));
    storeAddressForm.setFieldsValue({
      ...getStoreAddressInitialValues(row),
      selected1688AddressId: selectedAddress?.id,
    });
    setStoreAddressModalOpen(true);
    if (!alibaba1688Addresses.length) void refresh1688Addresses(true);
  };

  const applySelected1688AddressToAccountForm = (addressId?: string) => {
    const address = addressId ? addressById.get(addressId) : null;
    if (!address) {
      accountForm.setFieldsValue({ selected1688AddressId: undefined, alibabaAddressId: undefined });
      return;
    }
    accountForm.setFieldsValue(get1688AddressFormValues(address));
  };

  const applySelected1688AddressToStoreForm = (addressId?: string) => {
    const address = addressId ? addressById.get(addressId) : null;
    if (!address) {
      storeAddressForm.setFieldsValue({ selected1688AddressId: undefined, alibabaAddressId: undefined });
      return;
    }
    storeAddressForm.setFieldsValue(get1688AddressFormValues(address));
  };

  const handleSaveStoreAddress = async () => {
    if (!erp || !editingStoreAddressAccount) return;
    const values = await storeAddressForm.validateFields();
    setSubmitting(`store-address:${editingStoreAddressAccount.id}`);
    try {
      await erp.purchase.action(buildStoreAddressPayload(
        values,
        editingStoreAddressAccount.id,
        editingStoreAddressAccount.alibaba1688AddressId,
      ));
      message.success("店铺 1688 地址已保存");
      setStoreAddressModalOpen(false);
      setEditingStoreAddressAccount(null);
      storeAddressForm.resetFields();
      await notifyChanged();
    } catch (error: any) {
      message.error(error?.message || "店铺 1688 地址保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleDeleteAccount = async (row: StoreAccountRow) => {
    if (!erp) return;
    setSubmitting(`delete-account:${row.id}`);
    try {
      try {
        await erp.account.delete({ id: row.id });
      } catch (error: any) {
        if (!isDeleteAccountHandlerMissing(error)) throw error;
        await erp.account.upsert({
          id: row.id,
          name: row.name,
          phone: row.phone,
          status: "deleted",
          source: row.source || "purchase_center",
        });
      }
      message.success("店铺已删除");
      if (editingStoreAddressAccount?.id === row.id) {
        setStoreAddressModalOpen(false);
        setEditingStoreAddressAccount(null);
      }
      await notifyChanged();
    } catch (error: any) {
      message.error(error?.message || "店铺删除失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleSetDefault1688PurchaseAccount = async (row: StoreAccountRow, default1688AccountId: string | null) => {
    if (!erp) return;
    setSubmitting(`store-1688-account:${row.id}`);
    try {
      await erp.purchase.action({
        action: "set_account_default_1688_purchase",
        accountId: row.id,
        default1688AccountId: default1688AccountId || null,
      });
      // 乐观更新本地状态
      setAccounts((prev) => prev.map((item) => (item.id === row.id ? { ...item, default1688PurchaseAccountId: default1688AccountId } : item)));
      message.success(default1688AccountId ? "默认 1688 采购账号已设置" : "已清空默认 1688 采购账号");
    } catch (error: any) {
      message.error(error?.message || "设置默认 1688 采购账号失败");
    } finally {
      setSubmitting(null);
    }
  };

  const accountColumns: ColumnsType<StoreAccountRow> = [
    { title: "店铺", dataIndex: "name", key: "name", width: 180, ellipsis: true },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
    {
      title: "1688 地址",
      key: "alibaba1688Address",
      ellipsis: true,
      render: (_value, row) => {
        const summary = storeAddressSummary(row);
        return summary ? (
          <Space direction="vertical" size={2}>
            <span>{summary}</span>
            <span style={{ color: "#667085", fontSize: 12 }}>
              {[row.alibaba1688FullName, row.alibaba1688Mobile].filter(Boolean).join(" / ") || "-"}
            </span>
          </Space>
        ) : <Tag color="warning">未绑定</Tag>;
      },
    },
    {
      title: "默认 1688 采购账号",
      key: "default1688PurchaseAccount",
      width: 220,
      render: (_value, row) => {
        const activeAccounts = purchase1688Accounts.filter((acct) => acct.status !== "disabled" && acct.configured && acct.authorized);
        if (activeAccounts.length === 0) {
          return (
            <Tooltip title="还没有可用的 1688 采购账号。请到「设置 → 1688 授权管理」绑定，或让 admin 在主控端添加。">
              <Tag color="default">暂无可用账号</Tag>
            </Tooltip>
          );
        }
        const options = [
          { label: "（不指定 / 用第一个有效账号）", value: "" },
          ...activeAccounts.map((acct) => ({
            label: acct.label || acct.memberId || acct.appKey || acct.id,
            value: acct.id,
          })),
        ];
        return (
          <Select
            size="small"
            style={{ width: "100%" }}
            value={row.default1688PurchaseAccountId || ""}
            options={options}
            disabled={!canManageStoreAddress || submitting === `store-1688-account:${row.id}`}
            onChange={(val) => handleSetDefault1688PurchaseAccount(row, val || null)}
          />
        );
      },
    },
    ...(canManageStoreAddress ? [{
      title: "操作",
      key: "actions",
      width: 190,
      render: (_value: unknown, row: StoreAccountRow) => (
        <Space size={6}>
          <Button
            size="small"
            icon={<EditOutlined />}
            loading={submitting === `store-address:${row.id}`}
            onClick={() => openStoreAddressModal(row)}
          >
            1688 地址
          </Button>
          {canManageAccounts ? (
            <Popconfirm
              title="删除店铺"
              description="删除后该店铺不再出现在列表和后续选择中，历史单据会保留。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDeleteAccount(row)}
            >
              <Button
                danger
                size="small"
                type="text"
                icon={<DeleteOutlined />}
                loading={submitting === `delete-account:${row.id}`}
              >
                删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    }] : []),
  ];

  const temuBindingColumns: ColumnsType<TemuOpenApiBinding> = [
    {
      title: "店铺",
      key: "mall",
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <span>{row.mallName || row.mallId}</span>
          <span style={{ color: "#667085", fontSize: 12 }}>mallId: {row.mallId}</span>
        </Space>
      ),
    },
    { title: "分区", dataIndex: "region", key: "region", width: 80 },
    {
      title: "授权状态",
      key: "authorized",
      width: 110,
      render: (_value, row) => (
        row.authorized
          ? <Tag color="success">已授权</Tag>
          : <Tag color="error">{row.status === "revoked" ? "已解绑" : "失效"}</Tag>
      ),
    },
    { title: "接口权限", dataIndex: "scopeCount", key: "scopeCount", width: 90, render: (value) => `${value || 0} 个` },
    {
      title: "Token 到期",
      dataIndex: "accessTokenExpiresAt",
      key: "expiry",
      width: 170,
      render: (value) => (value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-"),
    },
    ...(canManageAccounts ? [{
      title: "操作",
      key: "actions",
      width: 180,
      render: (_value: unknown, row: TemuOpenApiBinding) => (
        <Space size={6}>
          <Button
            size="small"
            onClick={() => {
              temuBindForm.resetFields();
              temuBindForm.setFieldsValue({ region: row.region, mallName: row.mallName });
              setTemuBindModalOpen(true);
            }}
          >
            重新绑定
          </Button>
          <Popconfirm
            title="解绑授权"
            description="解绑后将清除该店铺的 access_token，官方接口调用会停用。"
            okText="解绑"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleUnbindTemuOpenApi(row)}
          >
            <Button danger size="small" type="text" loading={submitting === `temu-openapi-unbind:${row.mallId}`}>
              解绑
            </Button>
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  if (!erp) {
    return <Alert type="error" showIcon message="当前环境缺少本地服务接口" />;
  }

  const tableLoading = loading && !loadedOnce && accounts.length > 0;

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {canManageAccounts ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateAccountModal}>
            绑定店铺
          </Button>
        </div>
      ) : (
        <Alert type="info" showIcon message="当前角色仅可查看店铺。" style={{ marginBottom: 12 }} />
      )}
      <Table
        size="small"
        rowKey="id"
        loading={tableLoading}
        columns={accountColumns}
        dataSource={sortedAccounts}
        pagination={{ pageSize: 5, showSizeChanger: false }}
      />

      <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <Space size={8} wrap>
            <strong>Temu 官方接口授权</strong>
            <span style={{ color: "#667085", fontSize: 12 }}>
              商家在卖家中心「授权管理」勾选「云舵AI」后复制 access_token 填入即可
            </span>
          </Space>
          {canManageAccounts ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                temuBindForm.resetFields();
                temuBindForm.setFieldsValue({ region: "CN" });
                setTemuBindModalOpen(true);
              }}
            >
              绑定授权
            </Button>
          ) : null}
        </div>
        <Table
          size="small"
          rowKey="mallId"
          columns={temuBindingColumns}
          dataSource={temuBindings}
          pagination={false}
          locale={{ emptyText: "尚未绑定任何店铺的官方授权" }}
        />
      </div>

      <Modal
        title="绑定 Temu 官方接口授权"
        open={temuBindModalOpen}
        okText="校验并绑定"
        cancelText="取消"
        confirmLoading={submitting === "temu-openapi-bind"}
        onOk={handleBindTemuOpenApi}
        onCancel={() => setTemuBindModalOpen(false)}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="如何获取 access_token"
          description="卖家中心 → 授权管理 → 选择应用「云舵AI」→ 勾选接口（建议全选）→ 确认 → 复制 token。App Key / App Secret 由系统默认配置，无需填写。"
        />
        <Form form={temuBindForm} layout="vertical">
          <Form.Item name="accessToken" label="access_token" rules={[{ required: true, message: "请粘贴 access_token" }]}>
            <Input.TextArea rows={3} placeholder="粘贴商家授权后复制的 access_token" />
          </Form.Item>
          <Form.Item name="region" label="分区" initialValue="CN" rules={[{ required: true, message: "请选择分区" }]} tooltip="必须与获取 token 的卖家中心同区，默认 CN">
            <Select
              options={[
                { value: "CN", label: "CN（全托/半托发品·库存·全托备货履约）" },
                { value: "PA", label: "PA（半托库存·调价核价）" },
                { value: "US", label: "US（美国半托履约）" },
                { value: "EU", label: "EU（欧区半托履约）" },
                { value: "GLOBAL", label: "GLOBAL（合规资质·全球半托履约）" },
              ]}
            />
          </Form.Item>
          <Form.Item name="mallName" label="店铺名称（可选）">
            <Input placeholder="便于识别，可留空（系统会尽量自动带出）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="绑定店铺"
        open={accountCreateModalOpen}
        okText="保存店铺"
        cancelText="取消"
        width={720}
        confirmLoading={submitting === "account"}
        onOk={handleCreateAccount}
        onCancel={() => setAccountCreateModalOpen(false)}
        destroyOnClose
      >
        <Form form={accountForm} layout="vertical">
          <Form.Item name="alibabaAddressId" hidden>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={10}>
              <Form.Item name="temuAccountId" label="关联采集店铺（可选，建议选）">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="从已采集的 Temu 店铺中选择，使账号与采集数据同源"
                  options={temuAccounts.map((a) => ({ value: a.id, label: a.name }))}
                  onChange={(v) => {
                    const hit = temuAccounts.find((x) => x.id === v);
                    if (hit) accountForm.setFieldsValue({ name: hit.name });
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="name" label="店铺名称" rules={[{ required: true, message: "请输入店铺名称" }]}>
                <Input placeholder="例如：主店铺" />
              </Form.Item>
            </Col>
            <Col xs={24} md={14}>
              <Form.Item name="selected1688AddressId" label="选择 1688 地址">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={alibaba1688AddressOptions}
                  loading={addressLoading}
                  notFoundContent={addressLoading ? "正在加载 1688 地址..." : "暂无 1688 地址"}
                  placeholder="从已同步地址选择"
                  onChange={applySelected1688AddressToAccountForm}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="label" label="地址名称" initialValue="默认地址" rules={[{ required: true, message: "请输入地址名称" }]}>
                <Input placeholder="默认地址" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="fullName" label="收件人" rules={[{ required: true, message: "请输入收件人" }]}>
                <Input placeholder="收件人姓名" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="mobile" label="手机号" rules={[{ required: true, message: "请输入手机号" }]}>
                <Input placeholder="13800000000" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="postCode" label="邮编">
                <Input placeholder="310000" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="provinceText" label="省">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="cityText" label="市">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="areaText" label="区">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="address" label="详细地址" rules={[{ required: true, message: "请输入详细地址" }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title={editingStoreAddressAccount ? `${editingStoreAddressAccount.name} · 1688 地址` : "1688 地址"}
        open={storeAddressModalOpen}
        okText="保存"
        cancelText="取消"
        confirmLoading={editingStoreAddressAccount ? submitting === `store-address:${editingStoreAddressAccount.id}` : false}
        onOk={handleSaveStoreAddress}
        onCancel={() => {
          setStoreAddressModalOpen(false);
          setEditingStoreAddressAccount(null);
        }}
        destroyOnClose
      >
        <Form form={storeAddressForm} layout="vertical">
          <Form.Item name="alibabaAddressId" hidden>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={24}>
              <Form.Item name="selected1688AddressId" label="选择 1688 地址">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={alibaba1688AddressOptions}
                  loading={addressLoading}
                  notFoundContent={addressLoading ? "正在加载 1688 地址..." : "暂无 1688 地址"}
                  placeholder="从已同步地址选择"
                  onChange={applySelected1688AddressToStoreForm}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="label" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
                <Input placeholder="默认地址" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="fullName" label="收件人" rules={[{ required: true, message: "请输入收件人" }]}>
                <Input placeholder="收件人姓名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="mobile" label="手机号" rules={[{ required: true, message: "请输入手机号" }]}>
                <Input placeholder="13800000000" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="postCode" label="邮编">
                <Input placeholder="310000" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="provinceText" label="省">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="cityText" label="市">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="areaText" label="区">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="address" label="详细地址" rules={[{ required: true, message: "请输入详细地址" }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Space>
  );
}
