// 一次性排查脚本：列出 1688 买家账号 + 收货地址表的真实状态。
// 用法：node-electron 模式跑 (ELECTRON_RUN_AS_NODE=1 electron.exe scripts/inspect-1688-addresses.cjs)
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(process.env.APPDATA, "temu-automation", "data", "erp.sqlite");
console.log("db:", dbPath);
const db = new Database(dbPath, { readonly: true });

function dump(title, sql, params) {
  console.log("\n=== " + title + " ===");
  try {
    const rows = params ? db.prepare(sql).all(params) : db.prepare(sql).all();
    if (rows.length === 0) {
      console.log("(empty)");
    } else {
      console.table(rows);
    }
  } catch (e) {
    console.log("err:", e.message);
  }
}

dump(
  "1688 buyer accounts",
  "SELECT id, label, member_id, status, configured, authorized FROM erp_1688_purchase_accounts ORDER BY id",
);

dump(
  "erp_1688_delivery_addresses schema",
  "PRAGMA table_info(erp_1688_delivery_addresses)",
);

dump(
  "all delivery addresses (key cols)",
  `SELECT id,
          company_id,
          account_id,
          purchase_1688_account_id,
          address_id,
          status,
          is_default,
          full_name,
          mobile,
          substr(address, 1, 40) AS address_head,
          updated_at
   FROM erp_1688_delivery_addresses
   ORDER BY purchase_1688_account_id, status, updated_at DESC`,
);

dump(
  "addresses grouped by purchase_1688_account_id × status",
  `SELECT COALESCE(purchase_1688_account_id, '(null)') AS buyer,
          status,
          COUNT(*) AS n,
          SUM(CASE WHEN COALESCE(address_id, '') = '' THEN 1 ELSE 0 END) AS missing_remote_id
   FROM erp_1688_delivery_addresses
   GROUP BY buyer, status
   ORDER BY buyer, status`,
);

db.close();
