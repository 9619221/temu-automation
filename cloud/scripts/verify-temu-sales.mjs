import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { dispatchParsers } from "../parsers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../db/migrations");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "temu-sales-"));
const dbPath = path.join(tmpDir, "temu-cloud.sqlite");
const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
}

const url_path = "/mms/venom/api/supplier/sales/management/listOverall";
const stat_date = new Date().toISOString().slice(0, 10);
const evt = {
  id: "evt-sales-1",
  url_path,
  mall_id: "mall-1",
  site: "CN",
  body_json: JSON.stringify({
    result: {
      pageItems: [
        {
          productSkcId: 123456789,
          productName: "Robot1 Sales Sample",
          category: "Tools",
          productSkcPicture: "https://example.test/skc.jpg",
          productId: 987654321,
          goodsId: 111222333,
          supplierId: 444555666,
          supplierName: "Supplier",
          skcExtCode: "SKC-EXT-1",
          asfScore: 4.8,
          commentNum: "12",
          qualityAfterSalesRate: "0.02",
          supplyStatus: "ON_SALE",
          stockStatus: 1,
          closeJitStatus: 0,
          skuQuantityDetailList: [
            { supplierPrice: 12.34, currencyType: "CNY", skuExtCode: "SKU-EXT-1" },
          ],
          todaySales: "5",
          last7DaysSales: 35,
          last30DaysSales: "120",
          totalSales: 4321,
          warehouseStock: "88",
          occupyStock: 3,
          unavailableStock: "2",
          adviceQuantity: 20,
          availableSaleDays: "7.5",
        },
      ],
    },
  }),
};

dispatchParsers(db, { tenant_id: "tenant-verify", device_id: "device-verify" }, [evt]);

const salesRow = db.prepare(`
  SELECT skc_id, total_sales, declared_price_cents, asf_score, stat_date
  FROM temu_sales_snapshot
  WHERE tenant_id = ?
`).get("tenant-verify");
const countAfterFirst = db.prepare("SELECT COUNT(*) AS n FROM temu_sales_snapshot").get().n;

assert.ok(countAfterFirst >= 1);
assert.equal(salesRow.skc_id, "123456789");
assert.equal(salesRow.total_sales, 4321);
assert.equal(salesRow.declared_price_cents, 1234);
assert.equal(salesRow.asf_score, "4.8");
assert.equal(salesRow.stat_date, stat_date);

dispatchParsers(db, { tenant_id: "tenant-verify", device_id: "device-verify" }, [evt]);

const countAfterSecond = db.prepare("SELECT COUNT(*) AS n FROM temu_sales_snapshot").get().n;
assert.equal(countAfterSecond, countAfterFirst);

const skcRow = db.prepare(`
  SELECT skc_id, sales_total, stock_available, declared_price_cents, price_currency
  FROM skc_snapshots
  WHERE tenant_id = ? AND skc_id = ?
`).get("tenant-verify", "123456789");
assert.equal(skcRow.sales_total, 4321);
assert.equal(skcRow.stock_available, 88);
assert.equal(skcRow.declared_price_cents, 1234);
assert.equal(skcRow.price_currency, "CNY");

const flowEvt = {
  id: "evt-flow-1",
  url_path: "/api/seller/full/flow/analysis/goods/list",
  mall_id: "mall-1",
  site: "CN",
  ts: Date.UTC(2026, 4, 23),
  body_json: JSON.stringify({
    result: {
      updateAt: Date.UTC(2026, 4, 21),
      total: 1,
      list: [
        {
          goodsId: 605835619077337,
          goodsName: "Flow Product",
          goodsImageUrl: "https://example.test/flow.jpg",
          category: { cat1Name: "Home", cat2Name: "Locks" },
          productSpuId: 8925143939,
          exposeNum: 6149,
          clickNum: 170,
          goodsDetailVisitNum: 116,
          goodsDetailVisitorNum: 96,
          addToCartUserNum: 47,
          collectUserNum: 0,
          payGoodsNum: 12,
          payOrderNum: 11,
          buyerNum: 11,
          searchPayGoodsNum: 1,
          recommendPayGoodsNum: 4,
          clickPayConversionRate: 0.0647,
          bsrGoods: true,
          growDataText: "205%",
          flowGrowStatus: 1,
        },
      ],
    },
  }),
};

dispatchParsers(db, { tenant_id: "tenant-verify", device_id: "device-verify" }, [flowEvt]);

const flowRow = db.prepare(`
  SELECT product_id, goods_id, stat_date, pay_goods_num, pay_order_num, buyer_num,
         category_name, bsr_goods
  FROM temu_product_flow_snapshot
  WHERE tenant_id = ?
`).get("tenant-verify");
assert.equal(flowRow.product_id, "8925143939");
assert.equal(flowRow.goods_id, "605835619077337");
assert.equal(flowRow.stat_date, "2026-05-21");
assert.equal(flowRow.pay_goods_num, 12);
assert.equal(flowRow.pay_order_num, 11);
assert.equal(flowRow.buyer_num, 11);
assert.equal(flowRow.category_name, "Home>Locks");
assert.equal(flowRow.bsr_goods, 1);

const result = {
  ok: true,
  dbPath,
  salesCount: countAfterSecond,
  upsertKeptRowCount: countAfterSecond === countAfterFirst,
  salesRow,
  skcRow,
  flowRow,
};

db.close();
console.log(JSON.stringify(result, null, 2));
