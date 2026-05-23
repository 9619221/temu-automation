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
      list: [],
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

const subOrderEvt = {
  id: "evt-sales-suborder",
  url_path,
  mall_id: "mall-1",
  site: "CN",
  body_json: JSON.stringify({
    result: {
      list: [],
      subOrderList: [
        {
          productSkcId: 22334455,
          productName: "SubOrder Product",
          category: "Kitchen",
          productSkcPicture: "https://example.test/suborder.jpg",
          productId: 66778899,
          goodsId: 99887766,
          supplierId: 444555666,
          supplierName: "Supplier",
          skcExtCode: "SUB-SKC",
          skuQuantityDetailList: [
            {
              productSkuId: 121212,
              className: "Black",
              supplierPrice: 1999,
              currencyType: "CNY",
              skuExtCode: "SUB-SKU",
              todaySaleVolume: 3,
              lastSevenDaysSaleVolume: 9,
              lastThirtyDaysSaleVolume: 27,
              sellerWhStock: 6,
              inventoryNumInfo: { waitReceiveNum: 2 },
            },
          ],
          skuQuantityTotalInfo: {
            todaySaleVolume: 3,
            lastSevenDaysSaleVolume: 9,
            lastThirtyDaysSaleVolume: 27,
            totalSaleVolume: 39,
            lackQuantity: 1,
            adviceQuantity: 4,
            inventoryNumInfo: {
              warehouseInventoryNum: 6,
              expectedOccupiedInventoryNum: 2,
              unavailableWarehouseInventoryNum: 1,
              waitReceiveNum: 2,
            },
          },
          stockStatus: "NORMAL",
          supplyStatus: "ON_SALE",
          commentNum: 5,
        },
      ],
    },
  }),
};

dispatchParsers(db, { tenant_id: "tenant-verify", device_id: "device-verify" }, [subOrderEvt]);

const salesRow = db.prepare(`
  SELECT skc_id, mall_supplier_id, total_sales, declared_price_cents, asf_score, stat_date
  FROM temu_sales_snapshot
  WHERE tenant_id = ? AND mall_supplier_id = ? AND skc_id = ?
`).get("tenant-verify", "mall-1", "123456789");
const countAfterFirst = db.prepare("SELECT COUNT(*) AS n FROM temu_sales_snapshot").get().n;

assert.ok(countAfterFirst >= 1);
assert.equal(salesRow.skc_id, "123456789");
assert.equal(salesRow.mall_supplier_id, "mall-1");
assert.equal(salesRow.total_sales, 4321);
assert.equal(salesRow.declared_price_cents, 1234);
assert.equal(salesRow.asf_score, "4.8");
assert.equal(salesRow.stat_date, stat_date);

const subOrderSalesRow = db.prepare(`
  SELECT skc_id, today_sales, last7d_sales, last30d_sales, total_sales,
         warehouse_stock, occupy_stock, unavailable_stock, advice_qty
  FROM temu_sales_snapshot
  WHERE tenant_id = ? AND mall_supplier_id = ? AND skc_id = ?
`).get("tenant-verify", "mall-1", "22334455");
assert.equal(subOrderSalesRow.today_sales, 3);
assert.equal(subOrderSalesRow.last7d_sales, 9);
assert.equal(subOrderSalesRow.last30d_sales, 27);
assert.equal(subOrderSalesRow.total_sales, 39);
assert.equal(subOrderSalesRow.warehouse_stock, 6);
assert.equal(subOrderSalesRow.occupy_stock, 2);
assert.equal(subOrderSalesRow.unavailable_stock, 1);
assert.equal(subOrderSalesRow.advice_qty, 4);

dispatchParsers(db, { tenant_id: "tenant-verify", device_id: "device-verify" }, [evt]);

const countAfterSecond = db.prepare("SELECT COUNT(*) AS n FROM temu_sales_snapshot").get().n;
assert.equal(countAfterSecond, countAfterFirst);

const skcRow = db.prepare(`
  SELECT skc_id, mall_id, sales_total, stock_available, declared_price_cents, price_currency
  FROM skc_snapshots
  WHERE tenant_id = ? AND mall_id = ? AND skc_id = ?
`).get("tenant-verify", "mall-1", "123456789");
assert.equal(skcRow.mall_id, "mall-1");
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

const sameSkcMall2Evt = {
  ...evt,
  id: "evt-sales-mall-2",
  mall_id: "mall-2",
  body_json: JSON.stringify({
    result: {
      list: [],
      pageItems: [
        {
          productSkcId: 123456789,
          productName: "Mall 2 Same SKC",
          productId: 987654321,
          supplierId: "mall-2",
          skuQuantityDetailList: [{ supplierPrice: 10, currencyType: "CNY" }],
          skuQuantityTotalInfo: {
            todaySaleVolume: 8,
            totalSaleVolume: 88,
            inventoryNumInfo: { warehouseInventoryNum: 18 },
          },
        },
      ],
    },
  }),
};
dispatchParsers(db, { tenant_id: "tenant-verify", device_id: "device-verify" }, [sameSkcMall2Evt]);
const sameSkcRows = db.prepare(`
  SELECT mall_supplier_id, skc_id, today_sales, total_sales, warehouse_stock
  FROM temu_sales_snapshot
  WHERE tenant_id = ? AND skc_id = ?
  ORDER BY mall_supplier_id ASC
`).all("tenant-verify", "123456789");
assert.equal(sameSkcRows.length, 2);
assert.equal(sameSkcRows[0].mall_supplier_id, "mall-1");
assert.equal(sameSkcRows[1].mall_supplier_id, "mall-2");
assert.equal(sameSkcRows[1].today_sales, 8);
assert.equal(sameSkcRows[1].warehouse_stock, 18);

const activityEvt = {
  id: "evt-activity-1",
  url_path: "/api/kiana/gamblers/marketing/enroll/list",
  mall_id: "mall-1",
  site: "CN",
  ts: Date.UTC(2026, 4, 23),
  body_json: JSON.stringify({
    result: {
      list: [
        {
          activityThematicId: "act-100",
          activityName: "Summer Deals",
          enrollStatus: "AVAILABLE",
          productId: "987654321",
          productSkcId: "123456789",
          startTime: "2026-05-20 00:00:00",
          endTime: "2026-06-20 23:59:59",
          activityTypeName: "Full Managed Deals",
          enrollPrice: 277,
          suggestedPrice: 300,
          activityStock: 126,
          activityGoodsOrderCount: 6,
        },
      ],
    },
  }),
};
dispatchParsers(db, { tenant_id: "tenant-verify", device_id: "device-verify" }, [activityEvt]);
const activityRow = db.prepare(`
  SELECT mall_id, activity_kind, activity_id, activity_title, activity_type, activity_status,
         product_id, skc_id, signup_price_cents, suggested_price_cents, activity_stock,
         signup_price_diff_cents
  FROM temu_activity_snapshot
  WHERE tenant_id = ? AND mall_id = ?
`).get("tenant-verify", "mall-1");
assert.equal(activityRow.activity_kind, "activity");
assert.equal(activityRow.activity_id, "act-100");
assert.equal(activityRow.skc_id, "123456789");
assert.equal(activityRow.activity_type, "Full Managed Deals");
assert.equal(activityRow.signup_price_cents, 27700);
assert.equal(activityRow.suggested_price_cents, 30000);
assert.equal(activityRow.activity_stock, 126);
assert.equal(activityRow.signup_price_diff_cents, -2300);

const stockOrderEvt = {
  id: "evt-stock-order-1",
  url_path: "/bgSongbird-api/supplier/deliverGoods/platform/pageQuerySubPurchaseOrder",
  mall_id: "mall-1",
  site: "CN",
  ts: Date.UTC(2026, 4, 23),
  body_json: JSON.stringify({
    result: {
      pageItems: [
        {
          subPurchaseOrderSn: "SO-VERIFY-001",
          parentPurchaseOrderSn: "PO-VERIFY-001",
          deliveryOrderSn: "DO-VERIFY-001",
          deliveryBatchSn: "DB-VERIFY-001",
          productId: "PROD-VERIFY-001",
          productSkcId: "SKC-VERIFY-001",
          productSkuId: "SKU-VERIFY-001",
          skuExtCode: "SKU-EXT-VERIFY",
          productName: "Verify Stock Product",
          specName: "White / Standard",
          demandQty: "16",
          deliveredQty: 4,
          statusName: "待发货",
          receiveWarehouseName: "Temu Verify Warehouse",
          latestDeliveryTime: "2026-05-25 18:00:00",
        },
      ],
    },
  }),
};
dispatchParsers(db, { tenant_id: "tenant-verify", device_id: "device-verify" }, [stockOrderEvt]);
const stockOrderRow = db.prepare(`
  SELECT mall_id, stock_order_no, parent_order_no, delivery_order_sn, delivery_batch_sn,
         product_id, skc_id, sku_id, sku_ext_code, product_name, spec_name,
         demand_qty, delivered_qty, temu_status, receive_warehouse_name, latest_ship_at
  FROM temu_stock_order_snapshot
  WHERE tenant_id = ? AND mall_id = ? AND stock_order_no = ?
`).get("tenant-verify", "mall-1", "SO-VERIFY-001");
assert.equal(stockOrderRow.delivery_order_sn, "DO-VERIFY-001");
assert.equal(stockOrderRow.delivery_batch_sn, "DB-VERIFY-001");
assert.equal(stockOrderRow.product_id, "PROD-VERIFY-001");
assert.equal(stockOrderRow.skc_id, "SKC-VERIFY-001");
assert.equal(stockOrderRow.sku_id, "SKU-VERIFY-001");
assert.equal(stockOrderRow.sku_ext_code, "SKU-EXT-VERIFY");
assert.equal(stockOrderRow.demand_qty, 16);
assert.equal(stockOrderRow.delivered_qty, 4);
assert.equal(stockOrderRow.receive_warehouse_name, "Temu Verify Warehouse");

const result = {
  ok: true,
  dbPath,
  salesCount: db.prepare("SELECT COUNT(*) AS n FROM temu_sales_snapshot").get().n,
  stockOrderCount: db.prepare("SELECT COUNT(*) AS n FROM temu_stock_order_snapshot").get().n,
  upsertKeptRowCount: countAfterSecond === countAfterFirst,
  salesRow,
  subOrderSalesRow,
  skcRow,
  flowRow,
  sameSkcRows,
  activityRow,
  stockOrderRow,
};

db.close();
console.log(JSON.stringify(result, null, 2));
