/**
 * 按段 patch 服务器 ipc.cjs：加「采购自动备货」的 require + 2 个 action case。
 * 不整覆盖（服务器 ipc.cjs 与本地分叉）。幂等：已 patch 则跳过。
 * 用法：node deploy-patch-ipc-autopurchase.cjs /opt/temu-automation/electron/erp/ipc.cjs
 */
"use strict";
const fs = require("fs");
const p = process.argv[2];
if (!p) { console.error("缺 ipc.cjs 路径"); process.exit(1); }
let s = fs.readFileSync(p, "utf8");
let changed = false;

// 1. require temuAutoPurchase（插在 temuOpenApiShipping require 之后）
const reqAnchor = '} = require("./services/temuOpenApiShipping.cjs");';
if (!s.includes("temuAutoPurchase")) {
  if (!s.includes(reqAnchor)) { console.error("FAIL: 找不到 shipping require 锚点"); process.exit(2); }
  s = s.replace(reqAnchor, reqAnchor + '\nconst { getAutoPurchaseCandidates, applyAutoPurchaseBatch } = require("./services/temuAutoPurchase.cjs");');
  changed = true;
}

// 2. 两个 action case（插在 default 之前）
if (!s.includes("consign_auto_purchase_candidates")) {
  const anchor = '    default:\n      throw new Error(`Unsupported inventory action: ${action}`);';
  if (!s.includes(anchor)) { console.error("FAIL: 找不到 default 锚点"); process.exit(3); }
  const cases =
    '    case "consign_auto_purchase_candidates": {\n' +
    '      const mallId = optionalString(payload.mallId || payload.mall_id);\n' +
    '      return { action, ...getAutoPurchaseCandidates(db, { mallId }) };\n' +
    '    }\n' +
    '    case "consign_auto_purchase_apply": {\n' +
    '      const items = Array.isArray(payload.items) ? payload.items : [];\n' +
    '      return applyAutoPurchaseBatch(db, items).then((r) => ({ action, ...r }));\n' +
    '    }\n';
  s = s.replace(anchor, cases + anchor);
  changed = true;
}

if (changed) { fs.writeFileSync(p, s); console.log("patched OK"); }
else { console.log("已是最新，无需 patch"); }
