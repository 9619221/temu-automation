// 端到端验证「商品编码换货」（swap_sku）：真实 HTTP 路径
//   登录 → POST /api/inventory/action {action:"swap_sku"} → lanServer → performInventoryAction
// 跑临时 sqlite，验完即删。仅本地 dev 用，不碰生产。
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");
relaunchUnderElectronIfNeeded(__filename);

const { openErpDatabase } = require("../electron/db/connection.cjs");
const { nowIso } = require("../electron/erp/services/utils.cjs");
const {
  closeErp,
  initializeErp,
  registerErpIpcHandlers,
} = require("../electron/erp/ipc.cjs");

function seedInventory(userDataDir) {
  const db = openErpDatabase({ userDataDir });
  try {
    const now = nowIso();
    const tx = db.transaction(() => {
      // 两个店铺账户
      for (const [id, name] of [["acct_a", "店铺A"], ["acct_b", "店铺B"]]) {
        db.prepare(`
          INSERT INTO erp_accounts (id, company_id, name, status, source, created_at, updated_at)
          VALUES (@id, 'company_default', @name, 'online', 'test', @now, @now)
        `).run({ id, name, now });
      }
      // 编码 A：绑 acct_a，均价 5，库存 100；编码 B：绑 acct_b，均价 8，库存 0
      db.prepare(`
        INSERT INTO erp_skus (id, company_id, account_id, internal_sku_code, product_name,
          status, weighted_avg_cost, cost_balance_qty, created_at, updated_at)
        VALUES ('sku_a', 'company_default', 'acct_a', 'CODE-A', '编码A商品', 'active', 5, 100, @now, @now)
      `).run({ now });
      db.prepare(`
        INSERT INTO erp_skus (id, company_id, account_id, internal_sku_code, product_name,
          status, weighted_avg_cost, cost_balance_qty, created_at, updated_at)
        VALUES ('sku_b', 'company_default', 'acct_b', 'CODE-B', '编码B商品', 'active', 8, 20, @now, @now)
      `).run({ now });
      // 编码 C：account_id NULL（未绑店铺，用于验证报错）
      db.prepare(`
        INSERT INTO erp_skus (id, company_id, account_id, internal_sku_code, product_name,
          status, weighted_avg_cost, cost_balance_qty, created_at, updated_at)
        VALUES ('sku_c', 'company_default', NULL, 'CODE-C', '编码C商品', 'active', 0, 0, @now, @now)
      `).run({ now });
      // 给 A 一个可用批次：available 100，均价 5
      db.prepare(`
        INSERT INTO erp_inventory_batches (
          id, account_id, batch_code, sku_id, po_id, inbound_receipt_id,
          received_qty, available_qty, reserved_qty, blocked_qty, defective_qty,
          rework_qty, unit_landed_cost, qc_status, location_code,
          received_at, created_at, updated_at
        ) VALUES (
          'batch_a', 'acct_a', 'BATCH-A', 'sku_a', NULL, NULL,
          100, 100, 0, 0, 0, 0, 5, 'passed', NULL, @now, @now, @now
        )
      `).run({ now });
      // 组合装 X（换出方，自身无批次）：comp_1 ×1（acct_a，均价2，库存50） + comp_2 ×2（acct_b，均价1，库存100）
      // 组合装 Y（换入方，自身无批次）：comp_3 ×1 + comp_4 ×3（均无库存无均价，验证按数量分摊）
      const insertSku = db.prepare(`
        INSERT INTO erp_skus (id, company_id, account_id, internal_sku_code, product_name,
          sku_type, status, weighted_avg_cost, cost_balance_qty, created_at, updated_at)
        VALUES (@id, 'company_default', @acct, @code, @name, @type, 'active', @avg, @qty, @now, @now)
      `);
      insertSku.run({ id: "sku_bundle_x", acct: "acct_a", code: "BUNDLE-X", name: "组合装X", type: "bundle", avg: 0, qty: 0, now });
      insertSku.run({ id: "comp_1", acct: "acct_a", code: "COMP-1", name: "子商品1", type: "single", avg: 2, qty: 50, now });
      insertSku.run({ id: "comp_2", acct: "acct_b", code: "COMP-2", name: "子商品2", type: "single", avg: 1, qty: 100, now });
      insertSku.run({ id: "sku_bundle_y", acct: "acct_b", code: "BUNDLE-Y", name: "组合装Y", type: "bundle", avg: 0, qty: 0, now });
      insertSku.run({ id: "comp_3", acct: "acct_a", code: "COMP-3", name: "子商品3", type: "single", avg: 0, qty: 0, now });
      insertSku.run({ id: "comp_4", acct: "acct_a", code: "COMP-4", name: "子商品4", type: "single", avg: 0, qty: 0, now });
      const insertComp = db.prepare(`
        INSERT INTO erp_sku_bundle_components (id, company_id, bundle_sku_id, component_sku_id,
          qty, unit_cost, sort_order, status, created_at, updated_at)
        VALUES (@id, 'company_default', @bundle, @comp, @qty, 0, @sort, 'active', @now, @now)
      `);
      insertComp.run({ id: "bc_x1", bundle: "sku_bundle_x", comp: "comp_1", qty: 1, sort: 0, now });
      insertComp.run({ id: "bc_x2", bundle: "sku_bundle_x", comp: "comp_2", qty: 2, sort: 1, now });
      insertComp.run({ id: "bc_y1", bundle: "sku_bundle_y", comp: "comp_3", qty: 1, sort: 0, now });
      insertComp.run({ id: "bc_y2", bundle: "sku_bundle_y", comp: "comp_4", qty: 3, sort: 1, now });
      const insertBatch = db.prepare(`
        INSERT INTO erp_inventory_batches (
          id, account_id, batch_code, sku_id, po_id, inbound_receipt_id,
          received_qty, available_qty, reserved_qty, blocked_qty, defective_qty,
          rework_qty, unit_landed_cost, qc_status, location_code,
          received_at, created_at, updated_at
        ) VALUES (
          @id, @acct, @code, @sku, NULL, NULL,
          @qty, @qty, 0, 0, 0, 0, @cost, 'passed', NULL, @now, @now, @now
        )
      `);
      insertBatch.run({ id: "batch_comp_1", acct: "acct_a", code: "BATCH-C1", sku: "comp_1", qty: 50, cost: 2, now });
      insertBatch.run({ id: "batch_comp_2", acct: "acct_b", code: "BATCH-C2", sku: "comp_2", qty: 100, cost: 1, now });
    });
    tx();
  } finally {
    db.close();
  }
}

async function main() {
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "temu-swap-e2e-"));
  const handlers = new Map();
  const fakeIpcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    on() { return this; },
    removeListener() { return this; },
  };
  const invoke = async (channel, payload) => {
    const handler = handlers.get(channel);
    assert.ok(handler, `Missing IPC handler: ${channel}`);
    return handler({}, payload);
  };

  let serverUp = false;
  try {
    initializeErp({ userDataDir: tempUserData, backup: false });
    registerErpIpcHandlers(fakeIpcMain);
    await invoke("erp:client:set-host-mode");

    // 建一个 admin 用户（admin 在 /api/inventory/action 的 ACL 白名单里）
    await invoke("erp:user:upsert", {
      id: "user_admin_e2e",
      name: "Admin",
      role: "admin",
      accessCode: "admin-code",
    });

    seedInventory(tempUserData);

    const lan = await invoke("erp:lan:start", { port: 0, bindAddress: "127.0.0.1" });
    assert.equal(lan.running, true);
    serverUp = true;

    const requestUrl = (url, options = {}) => new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const body = options.body || null;
      const req = require("node:http").request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || "GET",
        headers: { ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}), ...(options.headers || {}) },
      }, (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { buf += c; });
        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: buf }));
      });
      req.on("error", reject);
      req.setTimeout(5000, () => req.destroy(new Error(`timeout: ${url}`)));
      if (body) req.write(body);
      req.end();
    });

    // 登录拿 cookie
    const login = await requestUrl(`${lan.localUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ login: "Admin", accessCode: "admin-code" }),
    });
    assert.equal(login.statusCode, 200, `login failed: ${login.body}`);
    const cookie = Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"][0] : login.headers["set-cookie"];
    assert.ok(cookie && cookie.includes("temu_erp_lan_session"), "no session cookie");

    const callSwap = (payload) => requestUrl(`${lan.localUrl}/api/inventory/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: cookie },
      body: JSON.stringify(payload),
    });

    // 未登录应 401
    const unauth = await requestUrl(`${lan.localUrl}/api/inventory/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "swap_sku", fromSkuId: "sku_a", toSkuId: "sku_b", fromQty: 1, toQty: 1 }),
    });
    assert.equal(unauth.statusCode, 401, `expect 401 unauth, got ${unauth.statusCode}`);

    // 正常换货（按用户例子）：A 减 10 件、手填总额 100；B 加 10 件，货值整笔搬给 B。
    //   A：旧 100 件 / 均价 5 / 货值 500 → 库存 90、货值 400、均价 400/90≈4.4444
    //   B：旧 20 件 / 均价 8 / 货值 160 → 库存 30、货值 260、均价 260/30≈8.6667；新批次单价 100/10=10
    const ok = await callSwap({
      action: "swap_sku",
      fromSkuId: "sku_a",
      toSkuId: "sku_b",
      fromQty: 10,
      toQty: 10,
      fromAmount: 100,
    });
    assert.equal(ok.statusCode, 200, `swap failed: ${ok.body}`);
    const okBody = JSON.parse(ok.body);
    assert.equal(okBody.ok, true);
    assert.equal(okBody.result.action, "swap_sku");
    assert.ok(Array.isArray(okBody.result.outLines), "outLines missing");
    assert.ok(okBody.result.inBatch && okBody.result.inBatch.id, "inBatch missing");

    const near = (a, b, label) => assert.ok(Math.abs(Number(a) - b) < 1e-6, `${label}: expect ${b}, got ${a}`);

    // 校验库存 + 货值 + ledger
    const db = openErpDatabase({ userDataDir: tempUserData });
    try {
      // A 可用降到 90；主表库存 90、货值 400、均价 400/90
      const aAvail = db.prepare("SELECT SUM(available_qty) AS q FROM erp_inventory_batches WHERE sku_id='sku_a'").get().q;
      assert.equal(aAvail, 90, `A available expect 90, got ${aAvail}`);
      const skuA = db.prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id='sku_a'").get();
      assert.equal(skuA.cost_balance_qty, 90, `A cost_balance_qty expect 90`);
      near(skuA.weighted_avg_cost, 400 / 90, "A avg");
      near(skuA.weighted_avg_cost * skuA.cost_balance_qty, 400, "A 货值");

      // B 新批次 available 10、单价=总额/数量=10；主表库存 30、货值 260、均价 260/30
      const bBatch = db.prepare("SELECT available_qty, unit_landed_cost FROM erp_inventory_batches WHERE sku_id='sku_b'").get();
      assert.equal(bBatch.available_qty, 10, `B available expect 10`);
      near(bBatch.unit_landed_cost, 10, "B 批次单价");
      const skuB = db.prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id='sku_b'").get();
      assert.equal(skuB.cost_balance_qty, 30, `B cost_balance_qty expect 30`);
      near(skuB.weighted_avg_cost, 260 / 30, "B avg");
      near(skuB.weighted_avg_cost * skuB.cost_balance_qty, 260, "B 货值");

      // ledger 两条：SKU_SWAP_OUT(-10, unit 10) / SKU_SWAP_IN(+10, unit 10)
      const out = db.prepare("SELECT qty_delta, unit_cost FROM erp_inventory_ledger_entries WHERE type='sku_swap_out'").all();
      assert.equal(out.length, 1, `swap_out ledger count expect 1`);
      assert.equal(out[0].qty_delta, -10);
      near(out[0].unit_cost, 10, "out unit_cost");
      const inn = db.prepare("SELECT qty_delta, unit_cost FROM erp_inventory_ledger_entries WHERE type='sku_swap_in'").all();
      assert.equal(inn.length, 1, `swap_in ledger count expect 1`);
      assert.equal(inn[0].qty_delta, 10);
      near(inn[0].unit_cost, 10, "in unit_cost");
    } finally {
      db.close();
    }

    // 边界1：A==B 应 400
    const sameSku = await callSwap({ action: "swap_sku", fromSkuId: "sku_a", toSkuId: "sku_a", fromQty: 1, toQty: 1, fromAmount: 10 });
    assert.equal(sameSku.statusCode, 400, `same-sku expect 400, got ${sameSku.statusCode}`);

    // 边界2：缺 fromAmount（总额）应 400
    const noAmount = await callSwap({ action: "swap_sku", fromSkuId: "sku_a", toSkuId: "sku_b", fromQty: 1, toQty: 1 });
    assert.equal(noAmount.statusCode, 400, `missing fromAmount expect 400, got ${noAmount.statusCode}`);

    // 边界3：库存不足应 400（A 现在只剩 90）
    const short = await callSwap({ action: "swap_sku", fromSkuId: "sku_a", toSkuId: "sku_b", fromQty: 999, toQty: 1, fromAmount: 100 });
    assert.equal(short.statusCode, 400, `insufficient expect 400, got ${short.statusCode}`);

    // 边界4：换入编码未绑店铺应 400
    const unbound = await callSwap({ action: "swap_sku", fromSkuId: "sku_a", toSkuId: "sku_c", fromQty: 1, toQty: 1, fromAmount: 10 });
    assert.equal(unbound.statusCode, 400, `unbound store expect 400, got ${unbound.statusCode}`);

    // 组合装1：换出组合装 X 5 套 → 按 BOM 扣子商品：comp_1 -5、comp_2 -10；换入 sku_b +5。
    //   货值 100 按「数量×均价」分摊：comp_1 权重 5×2=10、comp_2 权重 10×1=10 → 各 50。
    //   comp_1：50 件/货值100 → 45 件/货值50；comp_2：100 件/货值100 → 90 件/货值50。
    //   sku_b（前面用例后为 30 件/货值260）→ 35 件/货值360。组合装 X 自身不动。
    const bundleOut = await callSwap({
      action: "swap_sku",
      fromSkuId: "sku_bundle_x",
      toSkuId: "sku_b",
      fromQty: 5,
      toQty: 5,
      fromAmount: 100,
      sourceDocId: "swapdoc_bundle_1",
    });
    assert.equal(bundleOut.statusCode, 200, `bundle swap failed: ${bundleOut.body}`);
    {
      const db = openErpDatabase({ userDataDir: tempUserData });
      try {
        assert.equal(db.prepare("SELECT SUM(available_qty) q FROM erp_inventory_batches WHERE sku_id='comp_1'").get().q, 45, "comp_1 available expect 45");
        assert.equal(db.prepare("SELECT SUM(available_qty) q FROM erp_inventory_batches WHERE sku_id='comp_2'").get().q, 90, "comp_2 available expect 90");
        const c1 = db.prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id='comp_1'").get();
        assert.equal(c1.cost_balance_qty, 45);
        near(c1.weighted_avg_cost * c1.cost_balance_qty, 50, "comp_1 货值");
        const c2 = db.prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id='comp_2'").get();
        assert.equal(c2.cost_balance_qty, 90);
        near(c2.weighted_avg_cost * c2.cost_balance_qty, 50, "comp_2 货值");
        const bx = db.prepare("SELECT cost_balance_qty FROM erp_skus WHERE id='sku_bundle_x'").get();
        assert.equal(bx.cost_balance_qty, 0, "组合装 X 自身主表不应变动");
        assert.equal(db.prepare("SELECT COUNT(*) n FROM erp_inventory_batches WHERE sku_id='sku_bundle_x'").get().n, 0, "组合装 X 自身不应有批次");
        const skuB = db.prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id='sku_b'").get();
        assert.equal(skuB.cost_balance_qty, 35);
        near(skuB.weighted_avg_cost * skuB.cost_balance_qty, 360, "B 货值");
        // ledger：换出腿落在子商品上，共 2 条，同一 source_doc_id
        const legs = db.prepare("SELECT sku_id, qty_delta FROM erp_inventory_ledger_entries WHERE source_doc_id='swapdoc_bundle_1' AND type='sku_swap_out' ORDER BY sku_id").all();
        assert.equal(legs.length, 2, "bundle 换出腿 expect 2 条");
        assert.deepEqual(legs.map((l) => [l.sku_id, l.qty_delta]), [["comp_1", -5], ["comp_2", -10]]);
      } finally {
        db.close();
      }
    }

    // 组合装2：撤销（revert_swap_sku）多腿反冲 → 子商品回补、sku_b 收回
    const bundleRevert = await callSwap({ action: "revert_swap_sku", sourceDocId: "swapdoc_bundle_1" });
    assert.equal(bundleRevert.statusCode, 200, `bundle revert failed: ${bundleRevert.body}`);
    {
      const db = openErpDatabase({ userDataDir: tempUserData });
      try {
        assert.equal(db.prepare("SELECT SUM(available_qty) q FROM erp_inventory_batches WHERE sku_id='comp_1'").get().q, 50, "revert 后 comp_1 available expect 50");
        assert.equal(db.prepare("SELECT SUM(available_qty) q FROM erp_inventory_batches WHERE sku_id='comp_2'").get().q, 100, "revert 后 comp_2 available expect 100");
        const c1 = db.prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id='comp_1'").get();
        near(c1.weighted_avg_cost * c1.cost_balance_qty, 100, "revert 后 comp_1 货值");
        const skuB = db.prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id='sku_b'").get();
        assert.equal(skuB.cost_balance_qty, 30, "revert 后 B 回到 30 件");
        near(skuB.weighted_avg_cost * skuB.cost_balance_qty, 260, "revert 后 B 货值");
      } finally {
        db.close();
      }
    }

    // 组合装3：换入组合装 Y 2 套 → 子商品入库：comp_3 +2、comp_4 +6。
    //   子商品均价全 0 → 货值 40 按数量分摊（每件 5）：comp_3 +10、comp_4 +30。
    //   sku_a（前面用例后 90 件/货值400）→ 86 件/货值360。
    const bundleIn = await callSwap({
      action: "swap_sku",
      fromSkuId: "sku_a",
      toSkuId: "sku_bundle_y",
      fromQty: 4,
      toQty: 2,
      fromAmount: 40,
    });
    assert.equal(bundleIn.statusCode, 200, `bundle swap-in failed: ${bundleIn.body}`);
    {
      const db = openErpDatabase({ userDataDir: tempUserData });
      try {
        const c3 = db.prepare("SELECT SUM(available_qty) q, SUM(available_qty*unit_landed_cost) v FROM erp_inventory_batches WHERE sku_id='comp_3'").get();
        assert.equal(c3.q, 2, "comp_3 available expect 2");
        near(c3.v, 10, "comp_3 批次货值");
        const c4 = db.prepare("SELECT SUM(available_qty) q, SUM(available_qty*unit_landed_cost) v FROM erp_inventory_batches WHERE sku_id='comp_4'").get();
        assert.equal(c4.q, 6, "comp_4 available expect 6");
        near(c4.v, 30, "comp_4 批次货值");
        assert.equal(db.prepare("SELECT COUNT(*) n FROM erp_inventory_batches WHERE sku_id='sku_bundle_y'").get().n, 0, "组合装 Y 自身不应有批次");
        const skuA = db.prepare("SELECT weighted_avg_cost, cost_balance_qty FROM erp_skus WHERE id='sku_a'").get();
        assert.equal(skuA.cost_balance_qty, 86);
        near(skuA.weighted_avg_cost * skuA.cost_balance_qty, 360, "A 货值");
      } finally {
        db.close();
      }
    }

    console.log("swap_sku 端到端验证通过：货值守恒换货 + 5 个边界（未登录/同编码/缺总额/库存不足/未绑店铺）+ 组合装（换出按BOM扣子商品/多腿撤销回补/换入按BOM入子商品）全部符合预期");
  } finally {
    if (serverUp) { try { await invoke("erp:lan:stop"); } catch {} }
    try { closeErp(); } catch {}
    if (!process.exitCode) fs.rmSync(tempUserData, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
