/**
 * 按段 patch 服务器 ipc.cjs：加「快递映射表」的 require + 6 个 action case。不整覆盖、幂等。
 * 用法：node deploy-patch-ipc-autoship.cjs /opt/temu-automation/electron/erp/ipc.cjs
 */
"use strict";
const fs = require("fs");
const p = process.argv[2];
if (!p) { console.error("缺 ipc.cjs 路径"); process.exit(1); }
let s = fs.readFileSync(p, "utf8");
let changed = false;

const reqAnchor = 'const { getAutoPurchaseCandidates, applyAutoPurchaseBatch } = require("./services/temuAutoPurchase.cjs");';
if (!s.includes("temuAutoShipMap")) {
  if (!s.includes(reqAnchor)) { console.error("FAIL: 找不到 temuAutoPurchase require 锚点"); process.exit(2); }
  s = s.replace(reqAnchor, reqAnchor + '\nconst { listCarrierMap, upsertCarrierMap, deleteCarrierMap, getDefault: getAutoShipDefault, setDefault: setAutoShipDefault, listShippableProducts } = require("./services/temuAutoShipMap.cjs");');
  changed = true;
}

if (!s.includes("auto_ship_map_list")) {
  const anchor = '    default:\n      throw new Error(`Unsupported inventory action: ${action}`);';
  if (!s.includes(anchor)) { console.error("FAIL: 找不到 default 锚点"); process.exit(3); }
  const cases =
    '    case "auto_ship_map_list": {\n' +
    '      const mallId = optionalString(payload.mallId || payload.mall_id);\n' +
    '      return { action, rows: listCarrierMap(db, { mallId }) };\n' +
    '    }\n' +
    '    case "auto_ship_map_upsert": {\n' +
    '      const rows = Array.isArray(payload.rows) ? payload.rows : [];\n' +
    '      return { action, ...upsertCarrierMap(db, rows, optionalString(payload.actor)) };\n' +
    '    }\n' +
    '    case "auto_ship_map_delete": {\n' +
    '      const mallId = requireString(payload.mallId || payload.mall_id, "mallId");\n' +
    '      const productId = requireString(payload.productId || payload.product_id, "productId");\n' +
    '      return { action, ...deleteCarrierMap(db, { mallId, productId }) };\n' +
    '    }\n' +
    '    case "auto_ship_default_get": {\n' +
    '      return { action, default: getAutoShipDefault(db) };\n' +
    '    }\n' +
    '    case "auto_ship_default_set": {\n' +
    '      return { action, default: setAutoShipDefault(db, { carrierStrategy: payload.carrierStrategy, pickupPref: payload.pickupPref }, optionalString(payload.actor)) };\n' +
    '    }\n' +
    '    case "auto_ship_map_products": {\n' +
    '      return { action, products: listShippableProducts(db) };\n' +
    '    }\n';
  s = s.replace(anchor, cases + anchor);
  changed = true;
}

if (changed) { fs.writeFileSync(p, s); console.log("patched OK"); } else { console.log("已是最新，无需 patch"); }
