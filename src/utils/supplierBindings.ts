export interface SupplierBindingLike {
  id: string;
  skuId?: string | null;
  status?: string | null;
  isSkuPlaceholder?: boolean;
}

export function activeSupplierBindingsForSku<T extends SupplierBindingLike>(rows: T[], skuId?: string | null): T[] {
  if (!skuId) return [];
  return rows.filter((row) => (
    row.skuId === skuId
    && row.status !== "deleted"
    && !row.isSkuPlaceholder
  ));
}

export function removeSupplierBindingRows<T extends SupplierBindingLike>(rows: T[], ids: Iterable<string>): T[] {
  const removedIds = new Set(ids);
  return rows.filter((row) => !removedIds.has(row.id));
}
