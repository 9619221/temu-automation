import assert from "node:assert/strict";
import {
  activeSupplierBindingsForSku,
  removeSupplierBindingRows,
} from "../src/utils/supplierBindings.ts";

const rows = [
  { id: "source-a", skuId: "sku-1", status: "active" },
  { id: "source-b", skuId: "sku-1", status: "active" },
  { id: "source-deleted", skuId: "sku-1", status: "deleted" },
  { id: "source-other", skuId: "sku-2", status: "active" },
  { id: "placeholder", skuId: "sku-1", status: "active", isSkuPlaceholder: true },
];

const active = activeSupplierBindingsForSku(rows, "sku-1");
assert.deepEqual(active.map((row) => row.id), ["source-a", "source-b"]);
assert.deepEqual(removeSupplierBindingRows(rows, ["source-a"]).map((row) => row.id), [
  "source-b",
  "source-deleted",
  "source-other",
  "placeholder",
]);
assert.deepEqual(removeSupplierBindingRows(rows, active.map((row) => row.id)).map((row) => row.id), [
  "source-deleted",
  "source-other",
  "placeholder",
]);

console.log("supplier binding delete tests passed");
