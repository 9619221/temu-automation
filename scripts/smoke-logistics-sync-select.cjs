"use strict";

// 物流定时同步「选单逻辑」离线冒烟。验证 selectPoIdsForLogisticsSync 的 SQL 口径。
// 跑法：$env:ELECTRON_RUN_AS_NODE="1"; Start-Process node_modules\electron\dist\electron.exe -ArgumentList scripts\smoke-logistics-sync-select.cjs -Wait -NoNewWindow

const path = require("path");
const Database = require("better-sqlite3");
const fs = require("fs");
const _lines = [];
const _o = console.log.bind(console);
console.log = (...a) => { _lines.push(a.map(String).join(" ")); _o(...a); };
process.on("exit", () => { try { fs.writeFileSync(path.join(__dirname, "smoke-logistics-sync-select.out.txt"), _lines.join("\n"), "utf8"); } catch (e) { /* ignore */ } });

const db = new Database(":memory:");
db.exec(`CREATE TABLE erp_purchase_orders(
  id TEXT PRIMARY KEY, account_id TEXT, external_order_id TEXT, external_order_status TEXT,
  status TEXT, external_logistics_synced_at TEXT, external_logistics_json TEXT, created_at TEXT
);`);

const now = Date.now();
const H = 3600 * 1000, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const ins = db.prepare("INSERT INTO erp_purchase_orders(id,account_id,external_order_id,external_order_status,status,external_logistics_synced_at,external_logistics_json,created_at) VALUES (?,?,?,?,?,?,?,?)");
const bigJson = JSON.stringify({ l_id: "79008375901587", logistics_company: "中通快递", address: "义乌苏溪镇" });

//      id    acct  oid     ext_status         status       synced            json      created
ins.run("po1", "a1", "OID1", "waitbuyerreceive", "shipped",   null,            null,     iso(now - 1 * D)); // 选：在途没物流
ins.run("po2", "a1", "OID2", "waitbuyerreceive", "cancelled", null,            null,     iso(now - 1 * D)); // 排除：已取消
ins.run("po3", "a1", "OID3", "success",          "shipped",   null,            null,     iso(now - 1 * D)); // 排除：1688已完成
ins.run("po4", "a1", "OID4", "waitbuyerreceive", "inbounded", null,            null,     iso(now - 1 * D)); // 排除：已入库
ins.run("po5", "a1", "OID5", "waitbuyerreceive", "shipped",   iso(now - 10 * H), bigJson, iso(now - 1 * D)); // 排除：已拿到单号
ins.run("po6", "a1", "OID6", "waitbuyerreceive", "shipped",   iso(now - 5 * H),  "{}",    iso(now - 1 * D)); // 选：空壳且冷却过4h
ins.run("po7", "a1", "OID7", "waitbuyerreceive", "shipped",   iso(now - 1 * H),  "{}",    iso(now - 1 * D)); // 排除：空壳但冷却中
ins.run("po8", "a1", null,   "waitbuyerreceive", "shipped",   null,            null,     iso(now - 1 * D)); // 排除：没绑1688单号
ins.run("po9", "a1", "OID9", "waitbuyerreceive", "shipped",   null,            null,     iso(now - 8 * D)); // 排除：超7天窗口

const cutoff = iso(now - 168 * H);
const retryBefore = iso(now - 4 * H);
const rows = db.prepare(`
  SELECT id FROM erp_purchase_orders
  WHERE external_order_id IS NOT NULL AND external_order_id != ''
    AND status NOT IN ('cancelled','closed','inbounded','exception')
    AND COALESCE(external_order_status,'') NOT IN ('cancelled','orphan_cleared','closed','success')
    AND created_at >= @cutoff
    AND (
      external_logistics_synced_at IS NULL OR external_logistics_synced_at=''
      OR (COALESCE(length(external_logistics_json),0)<20 AND external_logistics_synced_at < @retryBefore)
    )
  ORDER BY (external_logistics_synced_at IS NULL OR external_logistics_synced_at='') DESC, created_at DESC
  LIMIT @limit
`).all({ cutoff, retryBefore, limit: 50 });

const got = rows.map((r) => r.id).sort();
const want = ["po1", "po6"];
let pass = 0, fail = 0;
if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log("PASS  选中集合 = " + JSON.stringify(want)); }
else { fail++; console.log("FAIL  选中=" + JSON.stringify(got) + " 期望=" + JSON.stringify(want)); }
const set = new Set(got);
const check = (id, should, why) => {
  const has = set.has(id);
  if (has === should) { pass++; console.log("  PASS  " + id + (should ? " 选中" : " 排除") + " (" + why + ")"); }
  else { fail++; console.log("  FAIL  " + id + " 实际" + (has ? "选中" : "排除") + " 期望" + (should ? "选中" : "排除") + " (" + why + ")"); }
};
check("po1", true, "在途没物流");
check("po2", false, "已取消");
check("po3", false, "1688已完成success");
check("po4", false, "已入库");
check("po5", false, "已拿到单号");
check("po6", true, "空壳且冷却过4h-重试");
check("po7", false, "空壳但冷却中1h");
check("po8", false, "没绑1688单号");
check("po9", false, "超7天窗口");
console.log(`\n===== 选单冒烟：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
