// 店号 / 店铺名的统一展示规则（店维度表格用）：
// - 店号：有 ERP 店号时显示「029店铺」；没有店号则回退平台店铺 ID（mall_id，不加后缀）；都没有给占位符
// - 店铺名：去掉数据里冗余的末尾「店铺」后缀，只留品牌名（如「Oasis Originals店铺」→「Oasis Originals」）

/** 店号列展示：`${store_code}店铺`，无店号时回退 mall_id，再无则 fallback */
export function formatStoreNo(
  storeCode: string | null | undefined,
  mallId?: string | null,
  fallback = "—",
): string {
  if (storeCode) return `${storeCode}店铺`;
  if (mallId) return mallId;
  return fallback;
}

/** 店铺名列展示：去掉末尾冗余的「店铺」后缀，只留品牌名 */
export function formatMallName(
  mallName: string | null | undefined,
  fallback = "—",
): string {
  const name = (mallName || "").replace(/店铺$/, "").trim();
  // 没起名的店：店铺名数据就是店号数字（如「068」），视为未命名，避免与店号列重复
  if (!name || /^\d+$/.test(name)) return fallback;
  return name;
}
