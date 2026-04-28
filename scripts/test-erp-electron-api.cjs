const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openErpDatabase } = require("../electron/db/connection.cjs");
const {
  closeErp,
  initializeErp,
  registerErpIpcHandlers,
} = require("../electron/erp/ipc.cjs");

async function main() {
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "temu-erp-ipc-"));
  const handlers = new Map();
  const fakeIpcMain = {
    handle(channel, handler) {
      assert.equal(typeof channel, "string");
      assert.equal(typeof handler, "function");
      handlers.set(channel, handler);
    },
  };

  try {
    initializeErp({
      userDataDir: tempUserData,
      backup: false,
    });
    registerErpIpcHandlers(fakeIpcMain);

    const invoke = async (channel, payload) => {
      const handler = handlers.get(channel);
      assert.ok(handler, `Missing IPC handler: ${channel}`);
      return handler({}, payload);
    };

    await invoke("erp:client:set-host-mode");

    const status = await invoke("erp:get-status");
    assert.equal(status.initialized, true);
    assert.ok(status.dbPath.endsWith(path.join("data", "erp.sqlite")));

    let authStatus = await invoke("erp:auth:get-status");
    assert.equal(authStatus.hasUsers, false);
    assert.equal(authStatus.currentUser, null);

    authStatus = await invoke("erp:auth:create-first-admin", {
      name: "Root Admin",
      accessCode: "root-code",
    });
    assert.equal(authStatus.hasUsers, true);
    assert.equal(authStatus.currentUser.role, "admin");

    authStatus = await invoke("erp:auth:logout");
    assert.equal(authStatus.currentUser, null);

    const account = await invoke("erp:account:upsert", {
      id: "acct_ipc",
      name: "IPC Demo Account",
      source: "test",
    });
    assert.equal(account.id, "acct_ipc");

    const user = await invoke("erp:user:upsert", {
      id: "user_ops_ipc",
      name: "Ops",
      role: "operations",
      accessCode: "ops-code",
    });
    assert.equal(user.role, "operations");
    assert.equal(user.hasAccessCode, true);
    const buyer = await invoke("erp:user:upsert", {
      id: "user_buyer_ipc",
      name: "Buyer",
      role: "buyer",
      accessCode: "buyer-code",
    });
    assert.equal(buyer.role, "buyer");
    const warehouseUser = await invoke("erp:user:upsert", {
      id: "user_warehouse_ipc",
      name: "Warehouse",
      role: "warehouse",
      accessCode: "warehouse-code",
    });
    assert.equal(warehouseUser.role, "warehouse");
    const financeUser = await invoke("erp:user:upsert", {
      id: "user_finance_ipc",
      name: "Finance",
      role: "finance",
      accessCode: "finance-code",
    });
    assert.equal(financeUser.role, "finance");

    await assert.rejects(
      () => invoke("erp:auth:create-first-admin", {
        name: "Another Admin",
        accessCode: "another-code",
      }),
      /Initial admin already exists/,
    );

    await assert.rejects(
      () => invoke("erp:auth:login", {
        login: "Buyer",
        accessCode: "bad-code",
      }),
      /用户名或访问码错误/,
    );

    authStatus = await invoke("erp:auth:login", {
      login: "Buyer",
      accessCode: "buyer-code",
    });
    assert.equal(authStatus.currentUser.role, "buyer");
    assert.equal((await invoke("erp:auth:get-current-user")).id, buyer.id);
    authStatus = await invoke("erp:auth:logout");
    assert.equal(authStatus.currentUser, null);

    const supplier = await invoke("erp:supplier:create", {
      id: "supplier_ipc",
      name: "IPC Supplier",
      categories: ["daily"],
    });
    assert.equal(supplier.id, "supplier_ipc");

    const sku = await invoke("erp:sku:create", {
      id: "sku_ipc",
      accountId: account.id,
      internalSkuCode: "SKU-IPC-001",
      productName: "IPC Demo SKU",
      supplierId: supplier.id,
    });
    assert.equal(sku.accountId, account.id);

    const skus = await invoke("erp:sku:list", { accountId: account.id });
    assert.equal(skus.length, 1);

    const seedDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      const now = new Date().toISOString();
      seedDb.transaction(() => {
        seedDb.prepare(`
          INSERT INTO erp_purchase_requests (
            id, account_id, sku_id, requested_by, reason, requested_qty,
            target_unit_cost, expected_arrival_date, evidence_json, status,
            created_at, updated_at
          )
          VALUES (
            'pr_ipc', @account_id, @sku_id, @requested_by, 'replenishment',
            120, 10.5, '2026-05-08', '["stock below safety line"]',
            'submitted', @now, @now
          )
        `).run({
          account_id: account.id,
          sku_id: sku.id,
          requested_by: user.id,
          now,
        });

        seedDb.prepare(`
          INSERT INTO erp_sourcing_candidates (
            id, account_id, pr_id, purchase_source, sourcing_method, supplier_id,
            supplier_name, product_title, unit_price, moq, lead_days, status,
            created_by, created_at, updated_at
          )
          VALUES (
            'candidate_ipc', @account_id, 'pr_ipc', 'existing_supplier',
            'manual', @supplier_id, @supplier_name, 'IPC Candidate Product',
            10.5, 50, 5, 'selected', @buyer_id, @now, @now
          )
        `).run({
          account_id: account.id,
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          buyer_id: buyer.id,
          now,
        });

        seedDb.prepare(`
          INSERT INTO erp_purchase_orders (
            id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
            status, payment_status, expected_delivery_date, total_amount,
            created_by, created_at, updated_at
          )
          VALUES (
            'po_ipc', @account_id, 'pr_ipc', 'candidate_ipc', @supplier_id,
            'PO-IPC-001', 'pending_finance_approval', 'unpaid',
            '2026-05-10', 1260, @buyer_id, @now, @now
          )
        `).run({
          account_id: account.id,
          supplier_id: supplier.id,
          buyer_id: buyer.id,
          now,
        });

        seedDb.prepare(`
          INSERT INTO erp_purchase_order_lines (
            id, account_id, po_id, sku_id, qty, unit_cost, expected_qty, received_qty
          )
          VALUES (
            'po_line_ipc', @account_id, 'po_ipc', @sku_id, 120, 10.5, 120, 0
          )
        `).run({
          account_id: account.id,
          sku_id: sku.id,
        });

        seedDb.prepare(`
          INSERT INTO erp_payment_approvals (
            id, account_id, po_id, amount, status, requested_by,
            created_at, updated_at
          )
          VALUES (
            'pay_ipc', @account_id, 'po_ipc', 1260, 'pending', @buyer_id,
            @now, @now
          )
        `).run({
          account_id: account.id,
          buyer_id: buyer.id,
          now,
        });

        seedDb.prepare(`
          INSERT INTO erp_purchase_orders (
            id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
            status, payment_status, expected_delivery_date, total_amount,
            created_by, created_at, updated_at
          )
          VALUES (
            'po_draft_ipc', @account_id, 'pr_ipc', 'candidate_ipc', @supplier_id,
            'PO-IPC-DRAFT', 'draft', 'unpaid',
            '2026-05-12', 630, @buyer_id, @now, @now
          )
        `).run({
          account_id: account.id,
          supplier_id: supplier.id,
          buyer_id: buyer.id,
          now,
        });

        seedDb.prepare(`
          INSERT INTO erp_purchase_order_lines (
            id, account_id, po_id, sku_id, qty, unit_cost, expected_qty, received_qty
          )
          VALUES (
            'po_line_draft_ipc', @account_id, 'po_draft_ipc', @sku_id, 60, 10.5, 60, 0
          )
        `).run({
          account_id: account.id,
          sku_id: sku.id,
        });

        seedDb.prepare(`
          INSERT INTO erp_purchase_orders (
            id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
            status, payment_status, expected_delivery_date, total_amount,
            created_by, created_at, updated_at
          )
          VALUES (
            'po_wh_ipc', @account_id, 'pr_ipc', 'candidate_ipc', @supplier_id,
            'PO-WH-001', 'shipped', 'paid',
            '2026-05-11', 420, @buyer_id, @now, @now
          )
        `).run({
          account_id: account.id,
          supplier_id: supplier.id,
          buyer_id: buyer.id,
          now,
        });

        seedDb.prepare(`
          INSERT INTO erp_purchase_order_lines (
            id, account_id, po_id, sku_id, qty, unit_cost, logistics_fee,
            expected_qty, received_qty
          )
          VALUES (
            'po_line_wh_ipc', @account_id, 'po_wh_ipc', @sku_id, 40, 10, 20,
            40, 0
          )
        `).run({
          account_id: account.id,
          sku_id: sku.id,
        });

        seedDb.prepare(`
          INSERT INTO erp_inbound_receipts (
            id, account_id, po_id, receipt_no, status, created_at, updated_at
          )
          VALUES (
            'inbound_wh_ipc', @account_id, 'po_wh_ipc', 'IN-WH-001',
            'pending_arrival', @now, @now
          )
        `).run({
          account_id: account.id,
          now,
        });

        seedDb.prepare(`
          INSERT INTO erp_inbound_receipt_lines (
            id, account_id, receipt_id, po_line_id, sku_id, expected_qty, received_qty
          )
          VALUES (
            'inbound_line_wh_ipc', @account_id, 'inbound_wh_ipc',
            'po_line_wh_ipc', @sku_id, 40, 40
          )
        `).run({
          account_id: account.id,
          sku_id: sku.id,
        });
      })();
    } finally {
      seedDb.close();
    }

    const purchaseWorkbench = await invoke("erp:purchase:workbench");
    assert.equal(purchaseWorkbench.purchaseRequests.length, 1);
    assert.equal(purchaseWorkbench.purchaseOrders.length, 3);
    assert.equal(purchaseWorkbench.paymentQueue.length, 1);
    assert.equal(purchaseWorkbench.paymentQueue[0].paymentApprovalId, "pay_ipc");

    const warehouseWorkbench = await invoke("erp:warehouse:workbench");
    assert.equal(warehouseWorkbench.inboundReceipts.length, 1);
    assert.equal(warehouseWorkbench.inboundReceipts[0].id, "inbound_wh_ipc");
    assert.equal(warehouseWorkbench.inventoryBatches.length, 0);

    const canTransition = await invoke("erp:workflow:can-transition", {
      entityType: "purchase_request",
      fromStatus: "draft",
      toStatus: "submitted",
      action: "submit_pr",
      role: "operations",
    });
    assert.equal(canTransition, true);

    const qcDecision = await invoke("erp:qc:decide", {
      actualSampleQty: 20,
      defectiveQty: 2,
    });
    assert.equal(qcDecision.recommendedStatus, "partial_passed");

    const generatedWorkItems = await invoke("erp:workItem:generate", {
      accountId: account.id,
      actor: { id: user.id, role: user.role },
      limit: 100,
    });
    assert.equal(generatedWorkItems.summary.created, 4);
    assert.equal(generatedWorkItems.items.length, 4);
    assert.equal(generatedWorkItems.stats.active, 4);

    const buyerWorkItems = await invoke("erp:workItem:list", {
      ownerRole: "buyer",
      activeOnly: true,
      limit: 20,
    });
    assert.equal(buyerWorkItems.length, 2);
    assert.equal(buyerWorkItems[0].evidence.length > 0, true);

    const inProgressWorkItem = await invoke("erp:workItem:update-status", {
      id: buyerWorkItems[0].id,
      status: "in_progress",
      actor: { id: user.id, role: "admin" },
    });
    assert.equal(inProgressWorkItem.status, "in_progress");

    const doneWorkItem = await invoke("erp:workItem:update-status", {
      id: buyerWorkItems[0].id,
      status: "done",
      actor: { id: user.id, role: "admin" },
    });
    assert.equal(doneWorkItem.status, "done");

    authStatus = await invoke("erp:auth:login", {
      login: "Buyer",
      accessCode: "buyer-code",
    });
    assert.equal(authStatus.currentUser.role, "buyer");
    const scopedBuyerWorkItems = await invoke("erp:workItem:list", {
      activeOnly: true,
      limit: 20,
    });
    assert.ok(scopedBuyerWorkItems.length > 0);
    assert.equal(scopedBuyerWorkItems.every((item) => item.ownerRole === "buyer"), true);
    await invoke("erp:auth:logout");

    let lanStatus = await invoke("erp:lan:get-status");
    assert.equal(lanStatus.running, false);

    lanStatus = await invoke("erp:lan:start", {
      port: 0,
      bindAddress: "127.0.0.1",
    });
    assert.equal(lanStatus.running, true);
    assert.ok(lanStatus.port > 0);

    const requestUrl = (url, options = {}) => new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const body = options.body || null;
      const req = require("node:http").request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || "GET",
        headers: {
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
          ...(options.headers || {}),
        },
      }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.setTimeout(5000, () => {
        req.destroy(new Error(`LAN request timeout: ${url}`));
      });
      if (body) req.write(body);
      req.end();
    });
    const health = await requestUrl(`${lanStatus.localUrl}/health`);
    assert.equal(health.statusCode, 200);
    assert.equal(JSON.parse(health.body).ok, true);

    const statusPage = await requestUrl(`${lanStatus.localUrl}/api/status`);
    assert.equal(statusPage.statusCode, 200);
    assert.equal(JSON.parse(statusPage.body).lan.running, true);

    const unauthPurchase = await requestUrl(`${lanStatus.localUrl}/purchase`);
    assert.equal(unauthPurchase.statusCode, 302);
    assert.match(unauthPurchase.headers.location, /^\/login/);

    const unauthPurchaseApi = await requestUrl(`${lanStatus.localUrl}/api/purchase/workbench`);
    assert.equal(unauthPurchaseApi.statusCode, 401);

    const loginPage = await requestUrl(`${lanStatus.localUrl}/login`);
    assert.equal(loginPage.statusCode, 200);
    assert.match(loginPage.body, /LAN 登录/);

    const failedLogin = await requestUrl(`${lanStatus.localUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ login: "Buyer", accessCode: "bad-code" }),
    });
    assert.equal(failedLogin.statusCode, 401);

    const emptyLogin = await requestUrl(`${lanStatus.localUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(emptyLogin.statusCode, 401);

    const unsafeNextLogin = await requestUrl(`${lanStatus.localUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        login: "Buyer",
        accessCode: "buyer-code",
        next: "//evil.example",
      }).toString(),
    });
    assert.equal(unsafeNextLogin.statusCode, 302);
    assert.equal(unsafeNextLogin.headers.location, "/");

    const login = await requestUrl(`${lanStatus.localUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ login: "Buyer", accessCode: "buyer-code" }),
    });
    assert.equal(login.statusCode, 200);
    const cookie = Array.isArray(login.headers["set-cookie"])
      ? login.headers["set-cookie"][0]
      : login.headers["set-cookie"];
    assert.ok(cookie && cookie.includes("temu_erp_lan_session"));

    const purchasePage = await requestUrl(`${lanStatus.localUrl}/purchase`, {
      headers: { Cookie: cookie },
    });
    assert.equal(purchasePage.statusCode, 200);
    assert.match(purchasePage.body, /Temu ERP LAN/);
    assert.match(purchasePage.body, /PO-IPC-001/);
    assert.match(purchasePage.body, /pay_ipc/);

    const purchaseApi = await requestUrl(`${lanStatus.localUrl}/api/purchase/workbench`, {
      headers: { Cookie: cookie },
    });
    assert.equal(purchaseApi.statusCode, 200);
    const purchaseApiBody = JSON.parse(purchaseApi.body);
    assert.equal(purchaseApiBody.workbench.purchaseRequests[0].id, "pr_ipc");
    assert.equal(purchaseApiBody.workbench.purchaseOrders[0].poNo, "PO-IPC-001");
    assert.equal(purchaseApiBody.workbench.paymentQueue[0].paymentApprovalId, "pay_ipc");

    const acceptPr = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
      },
      body: new URLSearchParams({
        action: "accept_pr",
        prId: "pr_ipc",
      }).toString(),
    });
    assert.equal(acceptPr.statusCode, 302);

    const markSourced = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
      },
      body: new URLSearchParams({
        action: "mark_sourced",
        prId: "pr_ipc",
      }).toString(),
    });
    assert.equal(markSourced.statusCode, 302);

    const submitPayment = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
      },
      body: new URLSearchParams({
        action: "submit_payment_approval",
        poId: "po_draft_ipc",
        amount: "630",
      }).toString(),
    });
    assert.equal(submitPayment.statusCode, 302);

    const purchaseAfterBuyerActions = await requestUrl(`${lanStatus.localUrl}/api/purchase/workbench`, {
      headers: { Cookie: cookie },
    });
    const buyerActionBody = JSON.parse(purchaseAfterBuyerActions.body);
    assert.equal(
      buyerActionBody.workbench.purchaseRequests.find((item) => item.id === "pr_ipc").status,
      "sourced",
    );
    assert.equal(
      buyerActionBody.workbench.purchaseOrders.find((item) => item.id === "po_draft_ipc").status,
      "pending_finance_approval",
    );
    assert.ok(
      buyerActionBody.workbench.paymentQueue.some((item) => item.poId === "po_draft_ipc" && item.paymentApprovalStatus === "pending"),
    );

    const buyerApproveDenied = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "approve_payment",
        paymentApprovalId: "pay_ipc",
      }),
    });
    assert.equal(buyerApproveDenied.statusCode, 400);

    const financeLogin = await requestUrl(`${lanStatus.localUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ login: "Finance", accessCode: "finance-code" }),
    });
    const financeCookie = Array.isArray(financeLogin.headers["set-cookie"])
      ? financeLogin.headers["set-cookie"][0]
      : financeLogin.headers["set-cookie"];
    assert.ok(financeCookie && financeCookie.includes("temu_erp_lan_session"));

    const approvePayment = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: financeCookie,
      },
      body: JSON.stringify({
        action: "approve_payment",
        paymentApprovalId: "pay_ipc",
      }),
    });
    assert.equal(approvePayment.statusCode, 200);

    const confirmPaid = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: financeCookie,
      },
      body: JSON.stringify({
        action: "confirm_paid",
        paymentApprovalId: "pay_ipc",
        paymentMethod: "bank_transfer",
        paymentReference: "PAY-IPC-001",
      }),
    });
    assert.equal(confirmPaid.statusCode, 200);
    const financeWorkbench = JSON.parse(confirmPaid.body).result.workbench;
    assert.equal(
      financeWorkbench.purchaseOrders.find((item) => item.id === "po_ipc").status,
      "paid",
    );
    assert.equal(
      financeWorkbench.paymentApprovals.find((item) => item.id === "pay_ipc").status,
      "paid",
    );

    const warehousePage = await requestUrl(`${lanStatus.localUrl}/warehouse`, {
      headers: { Cookie: cookie },
    });
    assert.equal(warehousePage.statusCode, 403);

    const warehouseLogin = await requestUrl(`${lanStatus.localUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ login: "Warehouse", accessCode: "warehouse-code" }),
    });
    const warehouseCookie = Array.isArray(warehouseLogin.headers["set-cookie"])
      ? warehouseLogin.headers["set-cookie"][0]
      : warehouseLogin.headers["set-cookie"];
    assert.ok(warehouseCookie && warehouseCookie.includes("temu_erp_lan_session"));

    const warehouseAllowedPage = await requestUrl(`${lanStatus.localUrl}/warehouse`, {
      headers: { Cookie: warehouseCookie },
    });
    assert.equal(warehouseAllowedPage.statusCode, 200);
    assert.match(warehouseAllowedPage.body, /IN-WH-001/);

    const warehouseApi = await requestUrl(`${lanStatus.localUrl}/api/warehouse/workbench`, {
      headers: { Cookie: warehouseCookie },
    });
    assert.equal(warehouseApi.statusCode, 200);
    assert.equal(JSON.parse(warehouseApi.body).workbench.inboundReceipts[0].status, "pending_arrival");

    const registerArrival = await requestUrl(`${lanStatus.localUrl}/api/warehouse/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: warehouseCookie,
      },
      body: new URLSearchParams({
        action: "register_arrival",
        receiptId: "inbound_wh_ipc",
      }).toString(),
    });
    assert.equal(registerArrival.statusCode, 302);

    const confirmCount = await requestUrl(`${lanStatus.localUrl}/api/warehouse/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: warehouseCookie,
      },
      body: new URLSearchParams({
        action: "confirm_count",
        receiptId: "inbound_wh_ipc",
      }).toString(),
    });
    assert.equal(confirmCount.statusCode, 302);

    const createBatches = await requestUrl(`${lanStatus.localUrl}/api/warehouse/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: warehouseCookie,
      },
      body: JSON.stringify({
        action: "create_batches",
        receiptId: "inbound_wh_ipc",
      }),
    });
    assert.equal(createBatches.statusCode, 200);
    const warehouseAfterBatches = JSON.parse(createBatches.body).result.workbench;
    assert.equal(
      warehouseAfterBatches.inboundReceipts.find((item) => item.id === "inbound_wh_ipc").status,
      "inbounded_pending_qc",
    );
    assert.equal(warehouseAfterBatches.inventoryBatches.length, 1);
    assert.equal(warehouseAfterBatches.inventoryBatches[0].receivedQty, 40);
    assert.equal(warehouseAfterBatches.inventoryBatches[0].blockedQty, 40);
    const qcBatchId = warehouseAfterBatches.inventoryBatches[0].id;

    const qcDeniedForWarehouse = await requestUrl(`${lanStatus.localUrl}/qc`, {
      headers: { Cookie: warehouseCookie },
    });
    assert.equal(qcDeniedForWarehouse.statusCode, 403);

    const qcApiDeniedForWarehouse = await requestUrl(`${lanStatus.localUrl}/api/qc/workbench`, {
      headers: { Cookie: warehouseCookie },
    });
    assert.equal(qcApiDeniedForWarehouse.statusCode, 403);

    const opsLogin = await requestUrl(`${lanStatus.localUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ login: "Ops", accessCode: "ops-code" }),
    });
    const opsCookie = Array.isArray(opsLogin.headers["set-cookie"])
      ? opsLogin.headers["set-cookie"][0]
      : opsLogin.headers["set-cookie"];
    assert.ok(opsCookie && opsCookie.includes("temu_erp_lan_session"));

    const qcPage = await requestUrl(`${lanStatus.localUrl}/qc`, {
      headers: { Cookie: opsCookie },
    });
    assert.equal(qcPage.statusCode, 200);
    assert.match(qcPage.body, /IN-WH-001/);

    const qcWorkbench = await requestUrl(`${lanStatus.localUrl}/api/qc/workbench`, {
      headers: { Cookie: opsCookie },
    });
    assert.equal(qcWorkbench.statusCode, 200);
    const qcWorkbenchBody = JSON.parse(qcWorkbench.body).workbench;
    assert.equal(qcWorkbenchBody.pendingBatches.length, 1);
    assert.equal(qcWorkbenchBody.pendingBatches[0].id, qcBatchId);

    const startQc = await requestUrl(`${lanStatus.localUrl}/api/qc/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: opsCookie,
      },
      body: new URLSearchParams({
        action: "start_qc",
        batchId: qcBatchId,
      }).toString(),
    });
    assert.equal(startQc.statusCode, 302);

    const qcInProgress = await requestUrl(`${lanStatus.localUrl}/api/qc/workbench`, {
      headers: { Cookie: opsCookie },
    });
    const qcInProgressBody = JSON.parse(qcInProgress.body).workbench;
    assert.equal(qcInProgressBody.pendingBatches[0].qcStatusValue, "in_progress");
    const qcInspectionId = qcInProgressBody.pendingBatches[0].qcId;
    assert.ok(qcInspectionId);

    const submitQc = await requestUrl(`${lanStatus.localUrl}/api/qc/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: opsCookie,
      },
      body: JSON.stringify({
        action: "submit_qc_percent",
        qcId: qcInspectionId,
        actualSampleQty: 20,
        defectiveQty: 2,
        remark: "IPC QC partial release",
      }),
    });
    assert.equal(submitQc.statusCode, 200);
    const submitQcBody = JSON.parse(submitQc.body).result;
    assert.equal(submitQcBody.result.decision.recommendedStatus, "partial_passed");
    assert.equal(submitQcBody.result.batch.availableQty, 36);
    assert.equal(submitQcBody.result.batch.blockedQty, 4);
    assert.equal(
      submitQcBody.workbench.inspections.find((item) => item.id === qcInspectionId).status,
      "partial_passed",
    );

    const outboundPage = await requestUrl(`${lanStatus.localUrl}/outbound`, {
      headers: { Cookie: opsCookie },
    });
    assert.equal(outboundPage.statusCode, 200);
    assert.match(outboundPage.body, /IN-WH-001/);

    const outboundWorkbench = await requestUrl(`${lanStatus.localUrl}/api/outbound/workbench`, {
      headers: { Cookie: opsCookie },
    });
    assert.equal(outboundWorkbench.statusCode, 200);
    const outboundWorkbenchBody = JSON.parse(outboundWorkbench.body).workbench;
    assert.equal(outboundWorkbenchBody.availableBatches.length, 1);
    assert.equal(outboundWorkbenchBody.availableBatches[0].id, qcBatchId);
    assert.equal(outboundWorkbenchBody.availableBatches[0].availableQty, 36);

    const createOutbound = await requestUrl(`${lanStatus.localUrl}/api/outbound/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: opsCookie,
      },
      body: JSON.stringify({
        action: "create_outbound_plan",
        batchId: qcBatchId,
        qty: 10,
        boxes: 1,
        remark: "IPC outbound plan",
      }),
    });
    assert.equal(createOutbound.statusCode, 200);
    const createOutboundBody = JSON.parse(createOutbound.body).result;
    const outboundId = createOutboundBody.result.shipment.id;
    assert.ok(outboundId);
    assert.equal(createOutboundBody.result.shipment.status, "pending_warehouse");
    assert.equal(
      createOutboundBody.workbench.availableBatches.find((item) => item.id === qcBatchId).availableQty,
      26,
    );
    assert.equal(
      createOutboundBody.workbench.outboundShipments.find((item) => item.id === outboundId).status,
      "pending_warehouse",
    );

    const startPicking = await requestUrl(`${lanStatus.localUrl}/api/outbound/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: warehouseCookie,
      },
      body: JSON.stringify({
        action: "start_picking",
        outboundId,
      }),
    });
    assert.equal(startPicking.statusCode, 200);
    assert.equal(
      JSON.parse(startPicking.body).result.workbench.outboundShipments.find((item) => item.id === outboundId).status,
      "picking",
    );

    const markPacked = await requestUrl(`${lanStatus.localUrl}/api/outbound/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: warehouseCookie,
      },
      body: JSON.stringify({
        action: "mark_packed",
        outboundId,
        boxes: 1,
      }),
    });
    assert.equal(markPacked.statusCode, 200);
    assert.equal(
      JSON.parse(markPacked.body).result.workbench.outboundShipments.find((item) => item.id === outboundId).status,
      "packed",
    );

    const confirmShippedOut = await requestUrl(`${lanStatus.localUrl}/api/outbound/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: warehouseCookie,
      },
      body: JSON.stringify({
        action: "confirm_shipped_out",
        outboundId,
        logisticsProvider: "Test Logistics",
        trackingNo: "TRACK-IPC-001",
      }),
    });
    assert.equal(confirmShippedOut.statusCode, 200);
    const confirmShippedOutBody = JSON.parse(confirmShippedOut.body).result;
    const shippedShipment = confirmShippedOutBody.workbench.outboundShipments.find((item) => item.id === outboundId);
    assert.equal(shippedShipment.status, "pending_ops_confirm");
    assert.equal(shippedShipment.trackingNo, "TRACK-IPC-001");
    assert.equal(
      confirmShippedOutBody.workbench.availableBatches.find((item) => item.id === qcBatchId).reservedQty,
      0,
    );

    const confirmOutboundDone = await requestUrl(`${lanStatus.localUrl}/api/outbound/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: opsCookie,
      },
      body: JSON.stringify({
        action: "confirm_outbound_done",
        outboundId,
      }),
    });
    assert.equal(confirmOutboundDone.statusCode, 200);
    assert.equal(
      JSON.parse(confirmOutboundDone.body).result.workbench.outboundShipments.find((item) => item.id === outboundId).status,
      "confirmed",
    );

    lanStatus = await invoke("erp:lan:stop");
    assert.equal(lanStatus.running, false);

    console.log("ERP Electron API check passed");
  } finally {
    closeErp();
    fs.rmSync(tempUserData, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
