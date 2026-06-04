"use strict";

// 送仓托管行「本地确认发货 → 扣本地库存 / 撤销 → 回补」核心逻辑。
// 抽成独立模块，便于 ipc.cjs 复用与离线冒烟测试共用同一份实现，杜绝逻辑漂移。
//
// 映射口径：
//   shop_name → erp_accounts.name 定账号；
//   明细 sku_code(回退 i_id) → erp_skus.internal_sku_code(限该账号) 定本地 SKU。
//   任一明细行编码未匹配 → 整单阻止（先维护编码绑定）。
// 幂等：只看单头 inventory_deducted 标记，不看聚水潭同步的 status。

const { INVENTORY_LEDGER_TYPE } = require("../workflow/enums.cjs");

function nowIso() {
  return new Date().toISOString();
}

function optionalString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function positiveInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// 把「下单 SKU + 数量」展开成实际扣库存的物理行（送仓发货扣减/回补共用）。
//   普通商品：原样一行，account 用自身绑定店铺（回退 fallbackAccountId）。
//   组合装(sku_type=bundle)：按 BOM 展开成各子商品行，qty = 套数 × 单套用量；
//     子商品库存批次记在子商品自绑店铺下，故 account 用子商品自身 account_id（不回退）。
//   组合装无组件 / 子商品已失效 / 子商品未绑有效店铺 / 单套用量非法 → 整单 throw。
function expandSkuToInventoryLines(db, { skuId, qty, fallbackAccountId }) {
  const sku = db.prepare(
    "SELECT id, sku_type, account_id, internal_sku_code FROM erp_skus WHERE id = ?",
  ).get(skuId);
  if (!sku) throw new Error(`商品不存在，无法扣库存：${skuId}`);
  const isBundle = String(sku.sku_type || "single").toLowerCase() === "bundle";
  if (!isBundle) {
    const accountId = optionalString(sku.account_id) || optionalString(fallbackAccountId);
    if (!accountId) throw new Error(`商品编码 ${sku.internal_sku_code || skuId} 未绑定店铺，无法定位库存账号`);
    return [{ skuId: sku.id, accountId, internalSkuCode: sku.internal_sku_code, qty, bundleSkuCode: null }];
  }
  const components = db.prepare(`
    SELECT c.component_sku_id AS comp_id, c.qty AS comp_qty,
           s.account_id AS comp_account_id, s.internal_sku_code AS comp_code, s.status AS comp_status
    FROM erp_sku_bundle_components c
    LEFT JOIN erp_skus s ON s.id = c.component_sku_id
    WHERE c.bundle_sku_id = ? AND c.status = 'active'
    ORDER BY c.sort_order ASC, c.created_at ASC
  `).all(sku.id);
  if (!components.length) {
    throw new Error(`组合装 ${sku.internal_sku_code || skuId} 未配置子商品，无法扣库存`);
  }
  const bundleCode = sku.internal_sku_code || skuId;
  const lines = [];
  for (const comp of components) {
    if (!comp.comp_id || comp.comp_status === "deleted") {
      throw new Error(`组合装 ${bundleCode} 的子商品已失效，请检查组合装配置`);
    }
    const compAccountId = optionalString(comp.comp_account_id);
    if (!compAccountId || compAccountId === "jst:account:default" || compAccountId === "jst:account:none") {
      throw new Error(`组合装 ${bundleCode} 的子商品 ${comp.comp_code || comp.comp_id} 未绑定有效店铺，无法定位库存账号`);
    }
    const perSet = Number(comp.comp_qty || 0);
    if (!(perSet > 0)) {
      throw new Error(`组合装 ${bundleCode} 的子商品 ${comp.comp_code || comp.comp_id} 单套用量非法`);
    }
    lines.push({
      skuId: comp.comp_id,
      accountId: compAccountId,
      internalSkuCode: comp.comp_code,
      qty: qty * perSet,
      bundleSkuCode: bundleCode,
    });
  }
  return lines;
}

function resolveConsignDeliveryLines(db, { oId, companyId }) {
  const head = db.prepare(
    "SELECT * FROM jst_consign_deliveries WHERE company_id = ? AND o_id = ? AND status_internal != 'deleted'",
  ).get(companyId, Number(oId));
  if (!head) throw new Error(`送仓托管单不存在：o_id=${oId}`);

  const shopName = optionalString(head.shop_name);
  if (!shopName) throw new Error(`送仓托管单缺少店铺名，无法定位账号：o_id=${oId}`);
  const account = db.prepare(
    "SELECT id, name FROM erp_accounts WHERE company_id = ? AND name = ?",
  ).get(companyId, shopName);
  if (!account) throw new Error(`未找到与店铺「${shopName}」对应的 ERP 账号，无法扣库存`);

  const items = db.prepare(
    "SELECT * FROM jst_consign_deliver_items WHERE company_id = ? AND o_id = ? AND status_internal != 'deleted'",
  ).all(companyId, Number(oId));
  if (!items.length) throw new Error(`送仓托管单无明细，无法扣库存：o_id=${oId}`);

  const lines = [];
  const unmatched = [];
  for (const item of items) {
    // 实发数量：本地 local_ship_qty 优先（默认全发=备货数 qty，逐条改后为实发）；为 0 表示该明细不发，跳过。
    const qty = positiveInteger(item.local_ship_qty != null ? item.local_ship_qty : item.qty, 0);
    if (qty <= 0) continue;
    const code = optionalString(item.sku_code) || optionalString(item.i_id);
    if (!code) { unmatched.push(item.name || item.sku_id || "(无编码)"); continue; }
    const sku = db.prepare(
      "SELECT id, internal_sku_code FROM erp_skus WHERE company_id = ? AND account_id = ? AND internal_sku_code = ?",
    ).get(companyId, account.id, code);
    if (!sku) { unmatched.push(code); continue; }
    // 组合装按 BOM 展开成子商品库存行；普通商品原样一行。子商品用自绑店铺扣库存。
    for (const phys of expandSkuToInventoryLines(db, { skuId: sku.id, qty, fallbackAccountId: account.id })) {
      lines.push({ oiId: item.oi_id, skuId: phys.skuId, accountId: phys.accountId, internalSkuCode: phys.internalSkuCode, qty: phys.qty, bundleSkuCode: phys.bundleSkuCode });
    }
  }
  if (unmatched.length) {
    throw new Error(`存在未匹配本地商品编码，整单不扣库存，请先维护编码绑定：${[...new Set(unmatched)].join("、")}`);
  }
  return { head, account, lines };
}

function shipConsignDelivery({ db, services, oId, companyId, actor }) {
  const { head, account, lines } = resolveConsignDeliveryLines(db, { oId, companyId });
  if (Number(head.inventory_deducted) === 1) {
    return { idempotent: true, message: "该送仓单已扣过本地库存，未重复扣减" };
  }
  const now = nowIso();
  const run = db.transaction(() => {
    const ledger = [];
    for (const line of lines) {
      const unitCost = services.inventory.getSkuWeightedAvgCost(line.skuId);
      let outLines;
      try {
        outLines = services.inventory.applyDirectOutbound({
          accountId: line.accountId,
          skuId: line.skuId,
          qty: line.qty,
          unitCost,
          ledgerType: INVENTORY_LEDGER_TYPE.OUTBOUND_TO_TEMU,
          sourceDocType: "consign_deliver",
          sourceDocId: `consign-ship:${oId}`,
          affectSkuTotal: true,  // 货真的发到 Temu 仓了，实物总量减少
          actor,
        });
      } catch (err) {
        if (/Insufficient available inventory/i.test(err?.message || "")) {
          const who = line.bundleSkuCode
            ? `组合装 ${line.bundleSkuCode} 的子商品 ${line.internalSkuCode}`
            : `商品编码 ${line.internalSkuCode}`;
          throw new Error(`${who} 在「${account.name}」可用库存不足，整单未发货`);
        }
        throw err;
      }
      ledger.push({ oiId: line.oiId, skuId: line.skuId, qty: line.qty, lines: outLines });
    }
    db.prepare(`
      UPDATE jst_consign_deliveries
      SET inventory_deducted = 1,
          local_status_override = '已发货',
          inventory_ledger_json = @ledger,
          local_status_by = @by,
          local_status_at = @now,
          updated_at = @now
      WHERE company_id = @company_id AND o_id = @o_id
    `).run({
      ledger: JSON.stringify(ledger),
      by: actor?.userId || actor?.name || actor?.id || null,
      now,
      company_id: companyId,
      o_id: Number(oId),
    });
    return ledger;
  });
  const ledger = run();
  return { deducted: true, lineCount: ledger.length, message: "已发货，本地库存已扣减" };
}

function unshipConsignDelivery({ db, services, oId, companyId, actor }) {
  const { head, account, lines } = resolveConsignDeliveryLines(db, { oId, companyId });
  if (Number(head.inventory_deducted) !== 1) {
    return { idempotent: true, message: "该送仓单未扣减本地库存，无需撤销" };
  }
  const now = nowIso();
  const run = db.transaction(() => {
    for (const line of lines) {
      const unitCost = services.inventory.getSkuWeightedAvgCost(line.skuId);
      services.inventory.applyDirectInbound({
        accountId: line.accountId,
        skuId: line.skuId,
        qty: line.qty,
        unitLandedCost: unitCost,
        ledgerType: INVENTORY_LEDGER_TYPE.OUTBOUND_TO_TEMU_REVERSAL,
        sourceDocType: "consign_deliver_revert",
        sourceDocId: `consign-unship:${oId}`,
        affectSkuTotal: true,  // 撤销发货，货回到本地仓，实物总量加回
        actor,
      });
    }
    db.prepare(`
      UPDATE jst_consign_deliveries
      SET inventory_deducted = 0,
          local_status_override = NULL,
          inventory_ledger_json = NULL,
          local_status_by = @by,
          local_status_at = @now,
          updated_at = @now
      WHERE company_id = @company_id AND o_id = @o_id
    `).run({
      by: actor?.userId || actor?.name || actor?.id || null,
      now,
      company_id: companyId,
      o_id: Number(oId),
    });
    return lines.length;
  });
  const restored = run();
  return { restored: true, lineCount: restored, message: "已撤销发货，本地库存已回补" };
}

// 保存某条明细的「本地实发数量」local_ship_qty。
// 约束：0 <= shipQty <= 备货数量 qty；已确认发货（inventory_deducted=1）的单必须先撤销才能改。
function setConsignDeliverItemShipQty({ db, oId, oiId, shipQty, companyId }) {
  const head = db.prepare(
    "SELECT * FROM jst_consign_deliveries WHERE company_id = ? AND o_id = ? AND status_internal != 'deleted'",
  ).get(companyId, Number(oId));
  if (!head) throw new Error(`送仓托管单不存在：o_id=${oId}`);
  if (Number(head.inventory_deducted) === 1) {
    throw new Error("该送仓单已确认发货，请先撤销发货再修改实发数量");
  }
  const item = db.prepare(
    "SELECT * FROM jst_consign_deliver_items WHERE company_id = ? AND o_id = ? AND CAST(oi_id AS TEXT) = CAST(? AS TEXT) AND status_internal != 'deleted'",
  ).get(companyId, Number(oId), String(oiId));
  if (!item) throw new Error(`送仓明细不存在：oi_id=${oiId}`);
  const planQty = positiveInteger(item.qty, 0);
  const raw = Number(shipQty);
  if (!Number.isFinite(raw) || raw < 0) throw new Error("实发数量非法");
  const next = Math.floor(raw);
  if (next > planQty) throw new Error(`实发数量不能超过备货数量 ${planQty}`);
  db.prepare(`
    UPDATE jst_consign_deliver_items
    SET local_ship_qty = @qty, updated_at = @now
    WHERE company_id = @company_id AND o_id = @o_id AND CAST(oi_id AS TEXT) = CAST(@oi_id AS TEXT)
  `).run({ qty: next, now: nowIso(), company_id: companyId, o_id: Number(oId), oi_id: String(oiId) });
  return { ok: true, oId: Number(oId), oiId, shipQty: next, planQty };
}

// ===== cloud-only 官方备货单(无聚水潭 o_id)的本地确认发货 =====
// 状态/实发数存独立表 erp_consign_local_state(PK mall_id+so_id，无 company 维度——cloud 单来自
// 官方 API 按 mall_id，与 CTE cloud_only 段不按 company 过滤一致)。账号定位照搬平台单确认收货
// (ipc.cjs resolveConsignAfterSaleSku)：货号(items_json.iId)→erp_skus，SKU 自绑店铺(account_id)
// 即扣库存账号；同货号多店报错不臆测，避免入错店。扣减口径与聚水潭单完全一致。

// 读取某 cloud 单的逐 SKU 实发数 {productSkuId: qty}；无记录返回 {}。
function readCloudShipMap(db, mallId, soId) {
  const row = db.prepare(
    "SELECT ship_qty_json FROM erp_consign_local_state WHERE mall_id = ? AND so_id = ?",
  ).get(String(mallId), String(soId));
  if (!row || !row.ship_qty_json) return {};
  try { const m = JSON.parse(row.ship_qty_json); return (m && typeof m === "object") ? m : {}; } catch { return {}; }
}

// 解析 cloud 备货单逐 SKU 的扣库存明细。返回 { head, lines:[{skuKey,skuId,accountId,internalSkuCode,qty}] }。
// 任一明细货号未匹配 / 同货号归属多店 → 整单 throw（先维护编码绑定 / 人工确认）。
function resolveCloudConsignLines(db, { mallId, soId }) {
  const head = db.prepare(
    "SELECT mall_id, so_id, items_json FROM erp_temu_openapi_consign WHERE mall_id = ? AND so_id = ?",
  ).get(String(mallId), String(soId));
  if (!head) throw new Error(`官方备货单不存在：mall_id=${mallId} so_id=${soId}`);
  let items;
  try { items = JSON.parse(head.items_json || "[]"); } catch { items = []; }
  if (!Array.isArray(items) || !items.length) throw new Error(`官方备货单无 SKU 明细，无法扣库存：${soId}`);

  const shipMap = readCloudShipMap(db, mallId, soId);
  const lines = [];
  const unmatched = [];
  const ambiguous = [];
  for (const it of items) {
    const skuKey = it.skuId != null ? String(it.skuId) : null;   // productSkuId
    const planQty = positiveInteger(it.qty, 0);
    // 实发数：ship_qty_json[skuKey] 优先（默认 = 备货数 qty）；为 0 表示该 SKU 不发，跳过。
    const shipQty = (skuKey != null && shipMap[skuKey] != null) ? positiveInteger(shipMap[skuKey], 0) : planQty;
    if (shipQty <= 0) continue;
    // 货号(iId = ext_code = internal_sku_code)直接匹配；货号空时兜底用 productSkuId→openapi_skus.ext_code 反查。
    let code = optionalString(it.iId);
    if (!code && skuKey) {
      const bridge = db.prepare(
        "SELECT ext_code FROM erp_temu_openapi_skus WHERE product_sku_id = ? AND ext_code IS NOT NULL AND ext_code != '' LIMIT 1",
      ).get(skuKey);
      if (bridge && bridge.ext_code) code = String(bridge.ext_code);
    }
    if (!code) { unmatched.push(it.name || skuKey || "(无货号)"); continue; }
    // SKU 自绑店铺(account_id)即扣库存账号；排除占位账号。不限 company（同平台单 resolveConsignAfterSaleSku）。
    const skuRows = db.prepare(
      "SELECT id, account_id, internal_sku_code FROM erp_skus " +
      "WHERE status != 'deleted' AND account_id IS NOT NULL " +
      "AND account_id NOT IN ('jst:account:default','jst:account:none') AND internal_sku_code = ?",
    ).all(String(code));
    if (!skuRows.length) { unmatched.push(code); continue; }
    const distinctAccounts = new Set(skuRows.map((r) => r.account_id));
    if (distinctAccounts.size > 1) { ambiguous.push(code); continue; }
    // 组合装按 BOM 展开成子商品库存行；普通商品原样一行。子商品用自绑店铺扣库存。
    for (const phys of expandSkuToInventoryLines(db, { skuId: skuRows[0].id, qty: shipQty, fallbackAccountId: skuRows[0].account_id })) {
      lines.push({
        skuKey,
        skuId: phys.skuId,
        accountId: phys.accountId,
        internalSkuCode: phys.internalSkuCode,
        qty: phys.qty,
        bundleSkuCode: phys.bundleSkuCode,
      });
    }
  }
  if (ambiguous.length) {
    throw new Error(`货号在多个店铺存在同编码商品，无法自动判定扣哪个店库存，请手工确认：${[...new Set(ambiguous)].join("、")}`);
  }
  if (unmatched.length) {
    throw new Error(`存在未匹配本地商品编码，整单不扣库存，请先维护编码绑定：${[...new Set(unmatched)].join("、")}`);
  }
  if (!lines.length) throw new Error("没有可发货的明细（实发数量都为 0）");
  return { head, lines };
}

function upsertCloudShipState(db, { mallId, soId, ledger, actor, now }) {
  db.prepare(`
    INSERT INTO erp_consign_local_state
      (mall_id, so_id, inventory_deducted, local_status_override, inventory_ledger_json, local_status_by, local_status_at, updated_at)
    VALUES (@mall_id, @so_id, 1, '已发货', @ledger, @by, @now, @now)
    ON CONFLICT(mall_id, so_id) DO UPDATE SET
      inventory_deducted = 1,
      local_status_override = '已发货',
      inventory_ledger_json = @ledger,
      local_status_by = @by,
      local_status_at = @now,
      updated_at = @now
  `).run({
    mall_id: String(mallId),
    so_id: String(soId),
    ledger: JSON.stringify(ledger),
    by: actor?.userId || actor?.name || actor?.id || null,
    now,
  });
}

function shipCloudConsignDelivery({ db, services, mallId, soId, actor }) {
  const existing = db.prepare(
    "SELECT inventory_deducted FROM erp_consign_local_state WHERE mall_id = ? AND so_id = ?",
  ).get(String(mallId), String(soId));
  if (existing && Number(existing.inventory_deducted) === 1) {
    return { idempotent: true, message: "该官方备货单已扣过本地库存，未重复扣减" };
  }
  const { lines } = resolveCloudConsignLines(db, { mallId, soId });
  const now = nowIso();
  const run = db.transaction(() => {
    const ledger = [];
    for (const line of lines) {
      const unitCost = services.inventory.getSkuWeightedAvgCost(line.skuId);
      let outLines;
      try {
        outLines = services.inventory.applyDirectOutbound({
          accountId: line.accountId,
          skuId: line.skuId,
          qty: line.qty,
          unitCost,
          ledgerType: INVENTORY_LEDGER_TYPE.OUTBOUND_TO_TEMU,
          sourceDocType: "consign_deliver",
          sourceDocId: `consign-ship-cloud:${mallId}:${soId}`,
          affectSkuTotal: true,  // 货真的发到 Temu 仓了，实物总量减少
          actor,
        });
      } catch (err) {
        if (/Insufficient available inventory/i.test(err?.message || "")) {
          const who = line.bundleSkuCode
            ? `组合装 ${line.bundleSkuCode} 的子商品 ${line.internalSkuCode}`
            : `商品编码 ${line.internalSkuCode}`;
          throw new Error(`${who} 可用库存不足，整单未发货`);
        }
        throw err;
      }
      ledger.push({ skuKey: line.skuKey, skuId: line.skuId, accountId: line.accountId, qty: line.qty, bundleSkuCode: line.bundleSkuCode, lines: outLines });
    }
    upsertCloudShipState(db, { mallId, soId, ledger, actor, now });
    return ledger;
  });
  const ledger = run();
  return { deducted: true, lineCount: ledger.length, message: "已发货，本地库存已扣减" };
}

function unshipCloudConsignDelivery({ db, services, mallId, soId, actor }) {
  const state = db.prepare(
    "SELECT inventory_deducted, inventory_ledger_json FROM erp_consign_local_state WHERE mall_id = ? AND so_id = ?",
  ).get(String(mallId), String(soId));
  if (!state || Number(state.inventory_deducted) !== 1) {
    return { idempotent: true, message: "该官方备货单未扣减本地库存，无需撤销" };
  }
  let ledger = [];
  try { ledger = JSON.parse(state.inventory_ledger_json || "[]"); } catch { ledger = []; }
  const now = nowIso();
  const run = db.transaction(() => {
    // 按扣减时记录的 account/sku/qty 原样回补，保证回补 = 当初所扣（不重新解析，避免编码绑定漂移导致错补）。
    for (const entry of (Array.isArray(ledger) ? ledger : [])) {
      const unitCost = services.inventory.getSkuWeightedAvgCost(entry.skuId);
      services.inventory.applyDirectInbound({
        accountId: entry.accountId,
        skuId: entry.skuId,
        qty: entry.qty,
        unitLandedCost: unitCost,
        ledgerType: INVENTORY_LEDGER_TYPE.OUTBOUND_TO_TEMU_REVERSAL,
        sourceDocType: "consign_deliver_revert",
        sourceDocId: `consign-unship-cloud:${mallId}:${soId}`,
        affectSkuTotal: true,  // 撤销发货，货回到本地仓，实物总量加回
        actor,
      });
    }
    db.prepare(`
      UPDATE erp_consign_local_state
      SET inventory_deducted = 0, local_status_override = NULL, inventory_ledger_json = NULL,
          local_status_by = @by, local_status_at = @now, updated_at = @now
      WHERE mall_id = @mall_id AND so_id = @so_id
    `).run({
      by: actor?.userId || actor?.name || actor?.id || null,
      now,
      mall_id: String(mallId),
      so_id: String(soId),
    });
    return Array.isArray(ledger) ? ledger.length : 0;
  });
  const restored = run();
  return { restored: true, lineCount: restored, message: "已撤销发货，本地库存已回补" };
}

// 保存某 cloud 备货单某 SKU 的本地实发数量(productSkuId → qty)。
// 约束：0 <= shipQty <= 备货数；已确认发货(inventory_deducted=1)须先撤销才能改。
function setCloudConsignItemShipQty({ db, mallId, soId, skuKey, shipQty }) {
  const key = optionalString(skuKey);
  if (!key) throw new Error("缺少 SKU 标识");
  const state = db.prepare(
    "SELECT inventory_deducted FROM erp_consign_local_state WHERE mall_id = ? AND so_id = ?",
  ).get(String(mallId), String(soId));
  if (state && Number(state.inventory_deducted) === 1) {
    throw new Error("该官方备货单已确认发货，请先撤销发货再修改实发数量");
  }
  const head = db.prepare(
    "SELECT items_json FROM erp_temu_openapi_consign WHERE mall_id = ? AND so_id = ?",
  ).get(String(mallId), String(soId));
  if (!head) throw new Error(`官方备货单不存在：${soId}`);
  let items = [];
  try { items = JSON.parse(head.items_json || "[]"); } catch { items = []; }
  const target = (Array.isArray(items) ? items : []).find((it) => String(it.skuId) === key);
  if (!target) throw new Error(`备货单明细不存在：sku=${key}`);
  const planQty = positiveInteger(target.qty, 0);
  const raw = Number(shipQty);
  if (!Number.isFinite(raw) || raw < 0) throw new Error("实发数量非法");
  const next = Math.min(Math.floor(raw), planQty);
  const shipMap = readCloudShipMap(db, mallId, soId);
  shipMap[key] = next;
  const now = nowIso();
  db.prepare(`
    INSERT INTO erp_consign_local_state (mall_id, so_id, inventory_deducted, ship_qty_json, updated_at)
    VALUES (@mall_id, @so_id, 0, @ship, @now)
    ON CONFLICT(mall_id, so_id) DO UPDATE SET ship_qty_json = @ship, updated_at = @now
  `).run({ mall_id: String(mallId), so_id: String(soId), ship: JSON.stringify(shipMap), now });
  return { ok: true, mallId: String(mallId), soId: String(soId), skuKey: key, shipQty: next, planQty };
}

module.exports = {
  expandSkuToInventoryLines,
  resolveConsignDeliveryLines,
  shipConsignDelivery,
  unshipConsignDelivery,
  setConsignDeliverItemShipQty,
  readCloudShipMap,
  resolveCloudConsignLines,
  shipCloudConsignDelivery,
  unshipCloudConsignDelivery,
  setCloudConsignItemShipQty,
};
