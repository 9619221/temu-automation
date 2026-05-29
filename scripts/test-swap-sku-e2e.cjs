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

    console.log("swap_sku 端到端验证通过：货值守恒换货 + 5 个边界（未登录/同编码/缺总额/库存不足/未绑店铺）全部符合预期");
  } finally {
    if (serverUp) { try { await invoke("erp:lan:stop"); } catch {} }
    try { closeErp(); } catch {}
    if (!process.exitCode) fs.rmSync(tempUserData, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
