// Inspect the ERP database for 1688 OAuth purchase accounts and delivery addresses.
// Usage:
//   ELECTRON_RUN_AS_NODE=1 electron scripts/inspect-1688-addresses.cjs
//   ERP_DATA_DIR=/path/to/data ELECTRON_RUN_AS_NODE=1 electron scripts/inspect-1688-addresses.cjs
//   ERP_DB=/path/to/erp.sqlite ELECTRON_RUN_AS_NODE=1 electron scripts/inspect-1688-addresses.cjs

const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function defaultUserDataDir() {
  if (process.env.APP_USER_DATA) return process.env.APP_USER_DATA;
  if (process.env.TEMU_USER_DATA) return process.env.TEMU_USER_DATA;
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "temu-automation");
}

function resolveDbPath() {
  const explicitDb = argValue("--db") || process.env.ERP_DB;
  if (explicitDb) return path.resolve(explicitDb);
  const explicitDataDir = argValue("--data-dir") || process.env.ERP_DATA_DIR || process.env.ERP_DATA_PATH;
  if (explicitDataDir) return path.join(path.resolve(explicitDataDir), "erp.sqlite");
  return path.join(defaultUserDataDir(), "data", "erp.sqlite");
}

function hasTable(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function dump(db, title, sql, params) {
  console.log(`\n=== ${title} ===`);
  try {
    const rows = params ? db.prepare(sql).all(params) : db.prepare(sql).all();
    if (!rows.length) console.log("(empty)");
    else console.table(rows);
  } catch (error) {
    console.log("err:", error.message);
  }
}

const dbPath = resolveDbPath();
console.log("db:", dbPath);
if (!fs.existsSync(dbPath)) {
  console.error("err: database file not found");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
try {
  if (!hasTable(db, "erp_1688_auth_settings")) {
    console.log("\n=== 1688 OAuth purchase accounts ===");
    console.log("err: missing table erp_1688_auth_settings");
  } else {
    dump(
      db,
      "1688 OAuth purchase accounts",
      `SELECT id,
              company_id,
              label,
              member_id,
              ali_id,
              resource_owner,
              status,
              CASE WHEN COALESCE(app_key, '') <> '' AND COALESCE(app_secret, '') <> '' THEN 1 ELSE 0 END AS configured,
              CASE WHEN COALESCE(access_token, '') <> '' THEN 1 ELSE 0 END AS authorized,
              CASE WHEN COALESCE(refresh_token, '') <> '' THEN 1 ELSE 0 END AS has_refresh_token,
              access_token_expires_at,
              refresh_token_expires_at,
              authorized_at,
              updated_at
       FROM erp_1688_auth_settings
       ORDER BY status = 'active' DESC, updated_at DESC, created_at DESC`,
    );
  }

  dump(db, "erp_1688_delivery_addresses schema", "PRAGMA table_info(erp_1688_delivery_addresses)");

  if (hasTable(db, "erp_1688_delivery_addresses")) {
    dump(
      db,
      "all delivery addresses (key columns)",
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
      db,
      "addresses grouped by purchase_1688_account_id x status",
      `SELECT COALESCE(purchase_1688_account_id, '(null)') AS purchase_1688_account_id,
              status,
              COUNT(*) AS total,
              SUM(CASE WHEN COALESCE(address_id, '') <> '' THEN 1 ELSE 0 END) AS remote_address_count,
              SUM(CASE WHEN is_default = 1 THEN 1 ELSE 0 END) AS default_count
       FROM erp_1688_delivery_addresses
       GROUP BY purchase_1688_account_id, status
       ORDER BY purchase_1688_account_id, status`,
    );
  }

  if (hasTable(db, "erp_accounts") && hasTable(db, "erp_1688_auth_settings")) {
    dump(
      db,
      "Temu store defaults",
      `SELECT acct.id,
              acct.name,
              acct.default_1688_purchase_account_id,
              auth.label AS default_1688_label,
              auth.status AS default_1688_status
       FROM erp_accounts acct
       LEFT JOIN erp_1688_auth_settings auth
         ON auth.id = acct.default_1688_purchase_account_id
       WHERE COALESCE(acct.default_1688_purchase_account_id, '') <> ''
       ORDER BY acct.updated_at DESC
       LIMIT 50`,
    );
  }
} finally {
  db.close();
}
