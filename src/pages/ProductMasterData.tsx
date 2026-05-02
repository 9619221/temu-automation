import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Form, Image, Input, Modal, Popconfirm, Row, Select, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";

const erp = window.electronAPI?.erp;

interface ErpAccountRow {
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
  alibaba1688AddressIsDefault?: number | boolean | null;
  updatedAt?: string;
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
  accountId?: string | null;
  accountName?: string | null;
  isDefault?: boolean | number | null;
  rawAddressParam?: Record<string, any> | null;
  addressParam?: Record<string, any> | null;
}

interface ErpSupplierRow {
  id: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  wechat?: string | null;
  categories?: string[];
  status?: string;
  updatedAt?: string;
}

interface ErpSkuRow {
  id: string;
  accountId?: string | null;
  accountName?: string | null;
  internalSkuCode: string;
  productName: string;
  colorSpec?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  supplierId?: string | null;
  actualStockQty?: number | null;
  warehouseLocation?: string | null;
  costPrice?: number | null;
  createdByName?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface SkuDialogValues {
  productName: string;
  colorSpec: string;
  accountId?: string;
}

interface SkuFilters {
  keyword: string;
  accountId?: string;
  status?: string;
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

type MasterDataMode = "skus" | "suppliers" | "stores";

interface ProductMasterDataProps {
  mode?: MasterDataMode;
}

function statusColor(status?: string) {
  switch (status) {
    case "active":
    case "online":
    case "success":
      return "success";
    case "offline":
    case "skipped":
      return "default";
    case "blocked":
    case "failed":
      return "error";
    default:
      return "processing";
  }
}

const STATUS_LABELS: Record<string, string> = {
  active: "启用",
  blocked: "停用",
  online: "在线",
  offline: "下线",
  success: "成功",
  skipped: "跳过",
  failed: "失败",
};

function statusLabel(status?: string | null) {
  if (!status) return "-";
  return STATUS_LABELS[status] || "未知状态";
}

function sourceLabel(source?: string | null) {
  if (!source) return "-";
  const labels: Record<string, string> = {
    product_master_data: "商品资料",
  };
  return labels[source] || "其他来源";
}

function canRole(role: string | undefined, roles: string[]) {
  return Boolean(role && roles.includes(role));
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatMoney(value?: number | string | null) {
  if (value === null || value === undefined || value === "") return "-";
  const amount = Number(value);
  if (Number.isNaN(amount)) return String(value);
  return `¥${amount.toFixed(2)}`;
}

function storeAddressSummary(row: ErpAccountRow) {
  return [row.alibaba1688ProvinceText, row.alibaba1688CityText, row.alibaba1688AreaText, row.alibaba1688Address]
    .filter(Boolean)
    .join("");
}

function getStoreAddressInitialValues(row: ErpAccountRow): StoreAddressValues {
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
  return [row.provinceText, row.cityText, row.areaText, row.address]
    .filter(Boolean)
    .join("");
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
  "内蒙古自治区", "广西壮族自治区", "西藏自治区", "宁夏回族自治区",
  "新疆维吾尔自治区", "香港特别行政区", "澳门特别行政区",
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
    limit: 500,
  };
}

function isDeleteAccountHandlerMissing(error: any) {
  return /deleteAccount is not defined/i.test(String(error?.message || error || ""));
}

export default function ProductMasterData({ mode = "skus" }: ProductMasterDataProps) {
  const auth = useErpAuth();
  const role = auth.currentUser?.role;
  const canManageAccounts = canRole(role, ["admin", "manager"]);
  const canManageStoreAddress = canRole(role, ["admin", "manager", "buyer"]);
  const canManageSuppliers = canRole(role, ["admin", "manager", "buyer"]);
  const canManageSkus = canRole(role, ["admin", "manager", "operations"]);

  const [accountForm] = Form.useForm();
  const [storeAddressForm] = Form.useForm<StoreAddressValues>();
  const [supplierForm] = Form.useForm();
  const [skuForm] = Form.useForm();
  const [accounts, setAccounts] = useState<ErpAccountRow[]>([]);
  const [suppliers, setSuppliers] = useState<ErpSupplierRow[]>([]);
  const [skus, setSkus] = useState<ErpSkuRow[]>([]);
  const [alibaba1688Addresses, setAlibaba1688Addresses] = useState<Alibaba1688AddressRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountCreateModalOpen, setAccountCreateModalOpen] = useState(false);
  const [storeAddressModalOpen, setStoreAddressModalOpen] = useState(false);
  const [editingStoreAddressAccount, setEditingStoreAddressAccount] = useState<ErpAccountRow | null>(null);
  const [skuFilters, setSkuFilters] = useState<SkuFilters>({ keyword: "" });
  const accountOptions = useMemo(
    () => accounts.map((account) => ({ label: account.name || account.id, value: account.id })),
    [accounts],
  );
  const accountNameById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name || account.id])),
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
  const hasSkuFilters = Boolean(skuFilters.keyword.trim() || skuFilters.accountId || skuFilters.status);
  const filteredSkus = useMemo(() => {
    const keyword = skuFilters.keyword.trim().toLowerCase();
    return skus.filter((sku) => {
      if (skuFilters.accountId && sku.accountId !== skuFilters.accountId) return false;
      if (skuFilters.status && sku.status !== skuFilters.status) return false;
      if (!keyword) return true;
      const accountName = sku.accountId ? accountNameById.get(sku.accountId) : "";
      const searchableText = [
        sku.internalSkuCode,
        sku.productName,
        sku.colorSpec,
        sku.category,
        accountName,
        sku.status ? statusLabel(sku.status) : "",
      ].filter(Boolean).join(" ").toLowerCase();
      return searchableText.includes(keyword);
    });
  }, [accountNameById, skuFilters, skus]);
  const pageTitle = mode === "suppliers" ? "供应商" : mode === "stores" ? "店铺" : "商品资料";
  const pageMeta = mode === "suppliers"
    ? [`供应商 ${suppliers.length}`]
    : mode === "stores"
      ? [`店铺 ${accounts.length}`]
      : [hasSkuFilters ? `商品 ${filteredSkus.length}/${skus.length}` : `商品 ${skus.length}`];

  const loadAll = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const [nextAccounts, nextSuppliers, nextSkus, purchaseWorkbench] = await Promise.all([
        erp.account.list({ limit: 500 }),
        erp.supplier.list({ limit: 500 }),
        erp.sku.list({ limit: 500 }),
        erp.purchase.workbench({ limit: 20 }).catch(() => null),
      ]);
      setAccounts(nextAccounts as ErpAccountRow[]);
      setSuppliers(nextSuppliers as ErpSupplierRow[]);
      setSkus(nextSkus as ErpSkuRow[]);
      const nextAddresses = get1688AddressRows(purchaseWorkbench);
      if (nextAddresses.length) setAlibaba1688Addresses(nextAddresses);
    } catch (error: any) {
      message.error(error?.message || "商品资料读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh1688Addresses = useCallback(async (syncIfEmpty = false) => {
    if (!erp) return [];
    setAddressLoading(true);
    try {
      const workbench = await erp.purchase.workbench({ limit: 500 }).catch(() => null);
      let nextAddresses = get1688AddressRows(workbench);
      if (!nextAddresses.length && syncIfEmpty) {
        const result = await erp.purchase.action({ action: "sync_1688_addresses", limit: 500 });
        nextAddresses = get1688AddressRows(result);
      }
      if (nextAddresses.length) setAlibaba1688Addresses(nextAddresses);
      return nextAddresses;
    } catch (error: any) {
      if (syncIfEmpty) message.error(error?.message || "1688 地址同步失败");
      return [];
    } finally {
      setAddressLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openCreateAccountModal = () => {
    accountForm.resetFields();
    accountForm.setFieldsValue({ label: "默认地址" });
    setAccountCreateModalOpen(true);
    if (!alibaba1688Addresses.length) void refresh1688Addresses(true);
  };

  const handleCreateAccount = async () => {
    if (!erp) return;
    const values = await accountForm.validateFields() as StoreAddressValues & { name: string; status?: string };
    setSubmitting("account");
    try {
      const account = await erp.account.upsert({
        name: values.name,
        status: values.status || "online",
        source: "product_master_data",
      });
      await erp.purchase.action(buildStoreAddressPayload(values, account.id));
      accountForm.resetFields();
      setAccountCreateModalOpen(false);
      message.success("店铺和 1688 地址已保存");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "店铺保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const openStoreAddressModal = (row: ErpAccountRow) => {
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
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "店铺 1688 地址保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleDeleteAccount = async (row: ErpAccountRow) => {
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
          source: row.source || "product_master_data",
        });
      }
      message.success("店铺已删除");
      if (editingStoreAddressAccount?.id === row.id) {
        setStoreAddressModalOpen(false);
        setEditingStoreAddressAccount(null);
      }
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "店铺删除失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleCreateSupplier = async () => {
    if (!erp) return;
    const values = await supplierForm.validateFields();
    setSubmitting("supplier");
    try {
      await erp.supplier.create({
        name: values.name,
        contactName: values.contactName,
        phone: values.phone,
        wechat: values.wechat,
        categories: values.categories || [],
        status: values.status || "active",
      });
      supplierForm.resetFields();
      message.success("供应商已创建");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "供应商创建失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleCreateSku = async () => {
    if (!erp) return;
    const values = await skuForm.validateFields() as SkuDialogValues;
    setSubmitting("sku");
    try {
      await erp.sku.create({
        accountId: values.accountId,
        productName: values.productName,
        colorSpec: values.colorSpec,
        status: "active",
      });
      skuForm.resetFields();
      setSkuModalOpen(false);
      message.success("商品资料已创建");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "商品资料创建失败");
    } finally {
      setSubmitting(null);
    }
  };

  const accountColumns: ColumnsType<ErpAccountRow> = [
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
    { title: "来源", dataIndex: "source", key: "source", width: 140, render: sourceLabel },
    ...(canManageStoreAddress ? [{
      title: "操作",
      key: "actions",
      width: 190,
      render: (_value: unknown, row: ErpAccountRow) => (
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

  const supplierColumns: ColumnsType<ErpSupplierRow> = [
    { title: "供应商", dataIndex: "name", key: "name", ellipsis: true },
    { title: "联系人", dataIndex: "contactName", key: "contactName", width: 110, render: (value) => value || "-" },
    { title: "电话", dataIndex: "phone", key: "phone", width: 140, render: (value) => value || "-" },
    { title: "微信", dataIndex: "wechat", key: "wechat", width: 140, render: (value) => value || "-" },
    {
      title: "类目",
      dataIndex: "categories",
      key: "categories",
      width: 180,
      render: (items: string[] = []) => items.length ? items.map((item) => <Tag key={item}>{item}</Tag>) : "-",
    },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
  ];

  const skuColumns: ColumnsType<ErpSkuRow> = [
    {
      title: "图片",
      dataIndex: "imageUrl",
      key: "imageUrl",
      width: 72,
      render: (value: string | null | undefined) => value ? (
        <Image
          src={value}
          alt="商品图片"
          width={44}
          height={44}
          preview={{ mask: "查看" }}
          style={{ borderRadius: 6, objectFit: "cover", background: "#f5f7fb" }}
        />
      ) : (
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 6,
            border: "1px dashed #d8dee9",
            color: "#98a2b3",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f8fafc",
          }}
        >
          无图
        </div>
      ),
    },
    { title: "标题", dataIndex: "productName", key: "productName", width: 220, ellipsis: true },
    { title: "商品编码", dataIndex: "internalSkuCode", key: "internalSkuCode", width: 138, ellipsis: true },
    {
      title: "实际库存数",
      dataIndex: "actualStockQty",
      key: "actualStockQty",
      width: 112,
      render: (value) => Number(value || 0),
    },
    {
      title: "仓位",
      dataIndex: "warehouseLocation",
      key: "warehouseLocation",
      width: 140,
      ellipsis: true,
      render: (value) => value || "-",
    },
    { title: "颜色及规格", dataIndex: "colorSpec", key: "colorSpec", width: 160, ellipsis: true, render: (value, row) => value || row.category || "-" },
    {
      title: "店铺",
      dataIndex: "accountId",
      key: "accountId",
      width: 140,
      ellipsis: true,
      render: (value, row) => row.accountName || accountNameById.get(value) || "-",
    },
    {
      title: "成本价",
      dataIndex: "costPrice",
      key: "costPrice",
      width: 112,
      render: formatMoney,
    },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 142, render: formatDateTime },
    { title: "修改时间", dataIndex: "updatedAt", key: "updatedAt", width: 142, render: formatDateTime },
    { title: "创建人", dataIndex: "createdByName", key: "createdByName", width: 120, ellipsis: true, render: (value) => value || "-" },
  ];

  const renderAccountCreateForm = () => (
    <Form form={accountForm} layout="vertical">
      <Form.Item name="alibabaAddressId" hidden>
        <Input />
      </Form.Item>
      <Row gutter={12}>
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
  );

  const renderAccountManager = () => (
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
        loading={loading}
        columns={accountColumns}
        dataSource={accounts}
        pagination={{ pageSize: 5, showSizeChanger: false }}
      />
    </Space>
  );

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="系统" title={pageTitle} subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="系统"
        title={pageTitle}
        meta={pageMeta}
        actions={[
          mode === "skus" && canManageSkus ? (
            <Button
              key="new-sku"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                skuForm.resetFields();
                if (accounts.length === 1) {
                  skuForm.setFieldsValue({ accountId: accounts[0].id });
                }
                setSkuModalOpen(true);
              }}
            >
              新增商品
            </Button>
          ) : null,
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadAll}>
            刷新
          </Button>,
        ].filter(Boolean)}
      />

      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {mode === "skus" ? (
        <div className="app-panel product-master-data-panel product-master-data-panel--skus">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">商品资料</div>
            </div>
          </div>
          {!canManageSkus ? (
            <Alert type="info" showIcon message="当前角色仅可查看商品资料。" style={{ marginBottom: 12 }} />
          ) : null}
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col xs={24} md={9}>
              <Input
                allowClear
                placeholder="商品编码 / 标题 / 颜色规格"
                value={skuFilters.keyword}
                onChange={(event) => setSkuFilters((current) => ({ ...current, keyword: event.target.value }))}
              />
            </Col>
            <Col xs={24} sm={12} md={5}>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="店铺"
                style={{ width: "100%" }}
                value={skuFilters.accountId}
                options={accountOptions}
                onChange={(value) => setSkuFilters((current) => ({ ...current, accountId: value }))}
              />
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Select
                allowClear
                placeholder="状态"
                style={{ width: "100%" }}
                value={skuFilters.status}
                options={[
                  { label: "启用", value: "active" },
                  { label: "停用", value: "blocked" },
                ]}
                onChange={(value) => setSkuFilters((current) => ({ ...current, status: value }))}
              />
            </Col>
            <Col xs={24} md={3}>
              <Button block disabled={!hasSkuFilters} onClick={() => setSkuFilters({ keyword: "" })}>
                清空
              </Button>
            </Col>
          </Row>
          <Table
            className="product-master-data-table product-master-data-table--skus"
            size="small"
            rowKey="id"
            loading={loading}
            columns={skuColumns}
            dataSource={filteredSkus}
            scroll={{ x: 1500, y: "max(220px, calc(100vh - 470px))" }}
            pagination={{ pageSize: 8, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
          />
        </div>
        ) : null}

        {mode === "suppliers" ? (
        <div className="app-panel">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">供应商</div>
            </div>
          </div>
          {canManageSuppliers ? (
            <Form form={supplierForm} layout="vertical">
              <Row gutter={12}>
                <Col xs={24} md={7}>
                  <Form.Item name="name" label="供应商名称" rules={[{ required: true, message: "请输入供应商名称" }]}>
                    <Input placeholder="例如：义乌某某工厂" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={4}>
                  <Form.Item name="contactName" label="联系人">
                    <Input placeholder="可选" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={4}>
                  <Form.Item name="phone" label="电话">
                    <Input placeholder="可选" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={4}>
                  <Form.Item name="wechat" label="微信">
                    <Input placeholder="可选" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={3}>
                  <Form.Item name="status" label="状态" initialValue="active">
                    <Select
                      options={[
                        { label: "启用", value: "active" },
                        { label: "停用", value: "blocked" },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={2}>
                  <Form.Item label=" ">
                    <Button type="primary" block icon={<PlusOutlined />} loading={submitting === "supplier"} onClick={handleCreateSupplier} />
                  </Form.Item>
                </Col>
                <Col xs={24}>
                  <Form.Item name="categories" label="类目">
                    <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入后回车" />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          ) : (
            <Alert type="info" showIcon message="当前角色仅可查看供应商。" style={{ marginBottom: 12 }} />
          )}
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            columns={supplierColumns}
            dataSource={suppliers}
            pagination={{ pageSize: 5, showSizeChanger: false }}
          />
        </div>
        ) : null}

        {mode === "stores" ? (
        <div className="app-panel">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">店铺</div>
            </div>
          </div>
          {renderAccountManager()}
        </div>
        ) : null}
      </Space>

      <Modal
        title="店铺"
        open={accountModalOpen}
        footer={null}
        width={720}
        onCancel={() => setAccountModalOpen(false)}
        destroyOnClose
      >
        {renderAccountManager()}
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
        {renderAccountCreateForm()}
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

      <Modal
        title="新增商品"
        open={skuModalOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting === "sku"}
        onOk={handleCreateSku}
        onCancel={() => setSkuModalOpen(false)}
        destroyOnClose
      >
        {accounts.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="还没有店铺"
            description="请先到采购中心右上角“店铺”新增店铺，再回来创建商品。"
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Form form={skuForm} layout="vertical">
          <Form.Item name="productName" label="商品名称" rules={[{ required: true, message: "请输入商品名称" }]}>
            <Input placeholder="例如：儿童保温杯" />
          </Form.Item>
          <Form.Item name="colorSpec" label="颜色/规格" rules={[{ required: true, message: "请输入颜色/规格" }]}>
            <Input placeholder="例如：蓝色 / 500ml / 单只装" />
          </Form.Item>
          <Form.Item name="accountId" label="店铺" rules={[{ required: true, message: "请选择店铺" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={accountOptions}
              placeholder="请选择商品所属店铺"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
