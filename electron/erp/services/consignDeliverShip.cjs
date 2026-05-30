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
    lines.push({ oiId: item.oi_id, skuId: sku.id, internalSkuCode: sku.internal_sku_code, qty });
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
          accountId: account.id,
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
          throw new Error(`商品编码 ${line.internalSkuCode} 在「${account.name}」可用库存不足，整单未发货`);
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
        accountId: account.id,
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

module.exports = {
  resolveConsignDeliveryLines,
  shipConsignDelivery,
  unshipConsignDelivery,
  setConsignDeliverItemShipQty,
};
