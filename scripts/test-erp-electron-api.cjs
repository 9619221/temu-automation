const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");

relaunchUnderElectronIfNeeded(__filename);

const { openErpDatabase } = require("../electron/db/connection.cjs");
const {
  HK_SERVER_URL,
  configureClientRuntime,
  getRuntimeStatus,
  setClientMode,
} = require("../electron/erp/clientRuntime.cjs");
const { createErpServices } = require("../electron/erp/services/index.cjs");
const {
  closeErp,
  initializeErp,
  registerErpIpcHandlers,
} = require("../electron/erp/ipc.cjs");

async function main() {
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "temu-erp-ipc-"));
  const handlers = new Map();
  const listeners = new Map();
  const fakeIpcMain = {
    handle(channel, handler) {
      assert.equal(typeof channel, "string");
      assert.equal(typeof handler, "function");
      handlers.set(channel, handler);
    },
    on(channel, listener) {
      assert.equal(typeof channel, "string");
      assert.equal(typeof listener, "function");
      listeners.set(channel, listener);
      return this;
    },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) {
        listeners.delete(channel);
      }
      return this;
    },
  };

  try {
    configureClientRuntime({ userDataDir: tempUserData });
    setClientMode({
      serverUrl: HK_SERVER_URL,
      sessionCookie: "temu_erp_lan_session=test-session",
      currentUser: { id: "client_user_ipc", name: "Client User", role: "operations" },
    });
    setClientMode({ serverUrl: HK_SERVER_URL });
    assert.equal(getRuntimeStatus().currentUser.id, "client_user_ipc");
    assert.equal(getRuntimeStatus().connected, true);

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

    const companies = await invoke("erp:company:list", { limit: 20 });
    assert.equal(companies.length, 1);
    assert.equal(companies[0].id, "company_default");

    const adminPermissionProfile = await invoke("erp:permission:get-profile");
    assert.equal(adminPermissionProfile.company.id, "company_default");
    assert.equal(adminPermissionProfile.rolePermissions.some((item) => item.role === "admin" && item.resourceKey === "*"), true);

    const adminUser = await invoke("erp:user:upsert", {
      id: "user_admin_ipc",
      name: "Root Admin",
      role: "admin",
      accessCode: "root-code",
    });
    assert.equal(adminUser.role, "admin");
    assert.equal(adminUser.companyId, "company_default");

    const account = await invoke("erp:account:upsert", {
      id: "acct_ipc",
      name: "IPC Demo Account",
      source: "test",
    });
    assert.equal(account.id, "acct_ipc");
    assert.equal(account.companyId, "company_default");

    const user = await invoke("erp:user:upsert", {
      id: "user_ops_ipc",
      name: "Ops",
      role: "operations",
      accessCode: "ops-code",
    });
    assert.equal(user.role, "operations");
    assert.equal(user.hasAccessCode, true);
    assert.equal(user.companyId, "company_default");
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

    const authSeedDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      const authNow = new Date().toISOString();
      authSeedDb.transaction(() => {
        const insertAuth = authSeedDb.prepare(`
          INSERT INTO erp_1688_auth_settings (
            id, company_id, app_key, app_secret, redirect_uri, access_token,
            refresh_token, member_id, ali_id, resource_owner, token_payload_json,
            access_token_expires_at, refresh_token_expires_at, authorized_at,
            label, status, created_at, updated_at
          )
          VALUES (
            @id, 'company_default', @app_key, @app_secret, @redirect_uri, @access_token,
            @refresh_token, @member_id, @ali_id, @resource_owner, '{}',
            @access_token_expires_at, @refresh_token_expires_at, @authorized_at,
            @label, @status, @created_at, @updated_at
          )
        `);
        insertAuth.run({
          id: "1688_auth_ipc_a",
          app_key: "app_key_a",
          app_secret: "app_secret_a",
          redirect_uri: "http://127.0.0.1:8788/1688/callback-a",
          access_token: "access_token_a",
          refresh_token: "refresh_token_a",
          member_id: "member_a",
          ali_id: "ali_a",
          resource_owner: "owner_a",
          access_token_expires_at: "2099-01-01T00:00:00.000Z",
          refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
          authorized_at: authNow,
          label: "账号 A",
          status: "active",
          created_at: authNow,
          updated_at: authNow,
        });
        insertAuth.run({
          id: "1688_auth_ipc_b",
          app_key: "app_key_b",
          app_secret: "app_secret_b",
          redirect_uri: "http://127.0.0.1:8788/1688/callback-b",
          access_token: "access_token_b",
          refresh_token: "refresh_token_b",
          member_id: "member_b",
          ali_id: "ali_b",
          resource_owner: "owner_b",
          access_token_expires_at: "2099-01-01T00:00:00.000Z",
          refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
          authorized_at: authNow,
          label: "账号 B",
          status: "active",
          created_at: authNow,
          updated_at: authNow,
        });
      })();
    } finally {
      authSeedDb.close();
    }

    const purchaseAccounts = await invoke("erp:purchase:action", {
      action: "list_1688_purchase_accounts",
      actor: { id: buyer.id, role: buyer.role },
    });
    assert.equal(purchaseAccounts.result.accounts.length, 2);
    const purchaseAccountA = purchaseAccounts.result.accounts.find((item) => item.id === "1688_auth_ipc_a");
    assert.ok(purchaseAccountA);
    assert.equal(purchaseAccountA.configured, true);
    assert.equal(purchaseAccountA.authorized, true);
    assert.equal(Object.prototype.hasOwnProperty.call(purchaseAccountA, "accessToken"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(purchaseAccountA, "refreshToken"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(purchaseAccountA, "appSecret"), false);

    await assert.rejects(
      () => invoke("erp:purchase:action", {
        action: "list_1688_purchase_accounts",
        actor: { id: financeUser.id, role: financeUser.role },
      }),
      /admin, manager, buyer/,
    );

    const renamedPurchaseAccount = await invoke("erp:purchase:action", {
      action: "update_1688_purchase_account_label",
      id: "1688_auth_ipc_a",
      label: "主买手账号",
      status: "active",
      actor: { id: user.id, role: "admin" },
    });
    assert.equal(renamedPurchaseAccount.result.account.label, "主买手账号");

    await assert.rejects(
      () => invoke("erp:purchase:action", {
        action: "set_default_1688_purchase_account",
        accountId: account.id,
        default1688AccountId: "1688_auth_ipc_a",
        actor: { id: buyer.id, role: buyer.role },
      }),
      /admin, manager/,
    );

    const setDefault1688PurchaseAccount = await invoke("erp:purchase:action", {
      action: "set_default_1688_purchase_account",
      accountId: account.id,
      default1688AccountId: "1688_auth_ipc_a",
      actor: { id: user.id, role: "admin" },
    });
    assert.equal(setDefault1688PurchaseAccount.result.ok, true);
    assert.equal(setDefault1688PurchaseAccount.result.default1688AccountId, "1688_auth_ipc_a");

    await assert.rejects(
      () => invoke("erp:purchase:action", {
        action: "delete_1688_purchase_account",
        id: "1688_auth_ipc_a",
        actor: { id: user.id, role: "admin" },
      }),
      (error) => {
        assert.equal(error.code, "PURCHASE_ACCOUNT_IN_USE");
        assert.equal(error.occupants?.[0]?.id, account.id);
        assert.match(error.message, /无法删除/);
        return true;
      },
    );

    await invoke("erp:purchase:action", {
      action: "set_default_1688_purchase_account",
      accountId: account.id,
      default1688AccountId: null,
      actor: { id: user.id, role: "admin" },
    });
    const deletedPurchaseAccount = await invoke("erp:purchase:action", {
      action: "delete_1688_purchase_account",
      id: "1688_auth_ipc_a",
      actor: { id: user.id, role: "admin" },
    });
    assert.equal(deletedPurchaseAccount.result.ok, true);
    assert.equal(deletedPurchaseAccount.result.id, "1688_auth_ipc_a");

    const accountScope = await invoke("erp:permission:upsert-scope", {
      userId: buyer.id,
      resourceType: "account",
      resourceId: account.id,
      accessLevel: "manage",
    });
    assert.equal(accountScope.companyId, "company_default");
    assert.equal(accountScope.resourceId, account.id);

    await assert.rejects(
      () => invoke("erp:auth:create-first-admin", {
        name: "Another Admin",
        accessCode: "another-code",
      }),
      /removed/,
    );

    const supplier = await invoke("erp:supplier:create", {
      id: "supplier_ipc",
      name: "IPC Supplier",
      categories: ["daily"],
    });
    assert.equal(supplier.id, "supplier_ipc");

    const companySku = await invoke("erp:sku:create", {
      id: "sku_company_ipc",
      productName: "Company Level SKU",
      colorSpec: "Blue / 500ml",
      supplierId: supplier.id,
    });
    assert.equal(companySku.accountId, null);
    assert.equal(companySku.companyId, "company_default");
    assert.match(companySku.internalSkuCode, /^\d{12}$/);
    assert.equal(companySku.colorSpec, "Blue / 500ml");

    const sku = await invoke("erp:sku:create", {
      id: "sku_ipc",
      accountId: account.id,
      internalSkuCode: "SKU-IPC-001",
      temuProductId: "PROD-IPC-001",
      temuSkcId: "SKC-IPC-001",
      temuSkuId: "SKU-TEMU-IPC",
      productName: "IPC Demo SKU",
      colorSpec: "White / Standard",
      supplierId: supplier.id,
    });
    assert.equal(sku.accountId, account.id);

    const skus = await invoke("erp:sku:list", { accountId: account.id });
    assert.equal(skus.length, 2);
    assert.equal(skus.some((item) => item.accountId === null), true);

    const companySkus = await invoke("erp:sku:list", { companyId: "company_default" });
    assert.equal(companySkus.length, 2);

    const deleteCompanySku = await invoke("erp:sku:delete", { id: companySku.id });
    assert.equal(deleteCompanySku.deleted, true);
    const companySkusAfterDelete = await invoke("erp:sku:list", { companyId: "company_default" });
    assert.equal(companySkusAfterDelete.length, 1);

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
            paid_amount, freight_amount, external_order_id, external_order_status,
            created_by, created_at, updated_at
          )
          VALUES (
            'po_ipc', @account_id, 'pr_ipc', 'candidate_ipc', @supplier_id,
            'PO-IPC-001', 'pending_finance_approval', 'unpaid',
            '2026-05-10', 1260, 1272, 12, '16880001', 'paid', @buyer_id, @now, @now
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
            'po_line_ipc', @account_id, 'po_ipc', @sku_id, 70, 10.5, 70, 0
          )
        `).run({
          account_id: account.id,
          sku_id: sku.id,
        });

        seedDb.prepare(`
          INSERT INTO erp_purchase_order_lines (
            id, account_id, po_id, sku_id, qty, unit_cost, expected_qty, received_qty
          )
          VALUES (
            'po_line_ipc_extra', @account_id, 'po_ipc', @sku_id, 50, 10.5, 50, 0
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
            'po_delete_ipc', @account_id, 'pr_ipc', 'candidate_ipc', @supplier_id,
            'PO-IPC-DELETE', 'draft', 'unpaid',
            '2026-05-13', 105, @buyer_id, @now, @now
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
            'po_line_delete_ipc', @account_id, 'po_delete_ipc', @sku_id, 10, 10.5, 10, 0
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

        seedDb.prepare(`
          INSERT INTO erp_purchase_orders (
            id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
            status, payment_status, expected_delivery_date, total_amount,
            created_by, created_at, updated_at
          )
          VALUES (
            'po_partial_ipc', @account_id, 'pr_ipc', 'candidate_ipc', @supplier_id,
            'PO-PARTIAL-001', 'paid', 'paid',
            '2026-05-14', 100, @buyer_id, @now, @now
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
            'po_line_partial_ipc', @account_id, 'po_partial_ipc', @sku_id, 10, 10, 10, 0
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
            'inbound_partial_ipc', @account_id, 'po_partial_ipc', 'IN-PARTIAL-001',
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
            'inbound_line_partial_ipc', @account_id, 'inbound_partial_ipc',
            'po_line_partial_ipc', @sku_id, 10, 0
          )
        `).run({
          account_id: account.id,
          sku_id: sku.id,
        });
      })();
    } finally {
      seedDb.close();
    }

    const referencedSkuDelete = await invoke("erp:sku:delete", { id: sku.id });
    assert.equal(referencedSkuDelete.deleted, true);
    assert.equal(referencedSkuDelete.archived, true);
    assert.match(referencedSkuDelete.referenceSummary, /采购需求/);
    const restoreSkuDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      restoreSkuDb.prepare("UPDATE erp_skus SET status = 'active' WHERE id = ?").run(sku.id);
    } finally {
      restoreSkuDb.close();
    }

    const purchaseWorkbench = await invoke("erp:purchase:workbench");
    assert.equal(purchaseWorkbench.purchaseRequests.length, 1);
    assert.equal(purchaseWorkbench.purchaseRequests[0].colorSpec, "White / Standard");
    assert.equal(purchaseWorkbench.purchaseRequests[0].primaryCandidateUnitPrice, 10.5);
    assert.equal(purchaseWorkbench.purchaseRequests[0].primaryCandidateSupplierName, supplier.name);
    assert.equal(purchaseWorkbench.purchaseOrders.length, 5);
    assert.equal(purchaseWorkbench.paymentQueue.length, 1);
    assert.equal(purchaseWorkbench.paymentQueue[0].paymentApprovalId, "pay_ipc");
    const detailedPurchaseOrder = purchaseWorkbench.purchaseOrders.find((item) => item.id === "po_ipc");
    assert.equal(detailedPurchaseOrder.lineItems.length, 2);
    assert.deepEqual(detailedPurchaseOrder.lineItems.map((item) => item.qty), [70, 50]);
    assert.deepEqual(detailedPurchaseOrder.lineItems.map((item) => item.amount), [735, 525]);
    assert.deepEqual(detailedPurchaseOrder.lineItems.map((item) => item.logisticsFee), [7, 5]);
    assert.deepEqual(detailedPurchaseOrder.lineItems.map((item) => item.paidAmount), [742, 530]);

    const sortedByAmountWorkbench = await invoke("erp:purchase:workbench", {
      purchaseOrderSortField: "paidAmount",
      purchaseOrderSortDirection: "ascend",
    });
    assert.deepEqual(
      sortedByAmountWorkbench.purchaseOrders.slice(0, 3).map((item) => item.id),
      ["po_partial_ipc", "po_delete_ipc", "po_wh_ipc"],
    );
    assert.equal(sortedByAmountWorkbench.purchaseOrderPage.sortField, "paidAmount");
    assert.equal(sortedByAmountWorkbench.purchaseOrderPage.sortDirection, "ascend");

    const sortedByRiskWorkbench = await invoke("erp:purchase:workbench", {
      purchaseOrderSortField: "riskTags",
      purchaseOrderSortDirection: "descend",
    });
    assert.equal(sortedByRiskWorkbench.purchaseOrders[0].id, "po_ipc");

    const paidPurchaseOrderWorkbench = await invoke("erp:purchase:workbench", {
      purchaseOrderPaymentState: "paid",
    });
    assert.deepEqual(
      new Set(paidPurchaseOrderWorkbench.purchaseOrders.map((item) => item.id)),
      new Set(["po_wh_ipc", "po_partial_ipc"]),
    );

    const offlinePurchaseOrderWorkbench = await invoke("erp:purchase:workbench", {
      purchaseOrderSourceState: "offline",
    });
    assert.equal(offlinePurchaseOrderWorkbench.purchaseOrderPage.total, 4);
    assert.equal(offlinePurchaseOrderWorkbench.purchaseOrders.every((item) => !item.externalOrderId), true);

    const missingAddressWorkbench = await invoke("erp:purchase:workbench", {
      purchaseOrderRiskState: "missing_address",
    });
    assert.equal(missingAddressWorkbench.purchaseOrderPage.total, 0);

    const highAmountWorkbench = await invoke("erp:purchase:workbench", {
      purchaseOrderAmountMin: 600,
    });
    assert.deepEqual(
      new Set(highAmountWorkbench.purchaseOrders.map((item) => item.id)),
      new Set(["po_ipc", "po_draft_ipc"]),
    );

    const deleteDraftPo = await invoke("erp:purchase:action", {
      action: "delete_po",
      poId: "po_delete_ipc",
      actor: { id: buyer.id, role: buyer.role },
    });
    assert.equal(deleteDraftPo.action, "delete_po");
    assert.equal(deleteDraftPo.result.deleted, true);
    assert.equal(deleteDraftPo.result.deletedLineCount, 1);
    assert.equal(deleteDraftPo.workbench.purchaseOrders.some((item) => item.id === "po_delete_ipc"), false);
    const deletePoDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      assert.equal(deletePoDb.prepare("SELECT COUNT(*) AS count FROM erp_purchase_orders WHERE id = ?").get("po_delete_ipc").count, 0);
      assert.equal(deletePoDb.prepare("SELECT COUNT(*) AS count FROM erp_purchase_order_lines WHERE po_id = ?").get("po_delete_ipc").count, 0);
    } finally {
      deletePoDb.close();
    }

    const warehouseWorkbench = await invoke("erp:warehouse:workbench");
    assert.equal(warehouseWorkbench.inboundReceipts.length, 2);
    assert.equal(warehouseWorkbench.inboundReceipts.some((item) => item.id === "inbound_wh_ipc"), true);
    assert.equal(warehouseWorkbench.inboundReceipts.some((item) => item.id === "inbound_partial_ipc"), true);
    assert.equal(warehouseWorkbench.inventoryBatches.length, 0);

    const canTransition = await invoke("erp:workflow:can-transition", {
      entityType: "purchase_request",
      fromStatus: "draft",
      toStatus: "buyer_processing",
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
    assert.equal(generatedWorkItems.summary.created, 5);
    assert.equal(generatedWorkItems.items.length, 5);
    assert.equal(generatedWorkItems.stats.active, 5);

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

    const messageHealth = await requestUrl(`${lanStatus.localUrl}/api/1688/message/health`);
    assert.equal(messageHealth.statusCode, 200);
    assert.equal(JSON.parse(messageHealth.body).ok, true);

    const receive1688Message = await requestUrl(`${lanStatus.localUrl}/api/1688/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messageId: "msg_ipc_1688",
        topic: "alibaba.trade.order.success",
        messageType: "order",
        orderId: "16880001",
      }),
    });
    assert.equal(receive1688Message.statusCode, 200);
    const receive1688Body = JSON.parse(receive1688Message.body);
    assert.equal(receive1688Body.ok, true);
    assert.equal(receive1688Body.success, true);
    const messageDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      const messageRow = messageDb.prepare("SELECT * FROM erp_1688_message_events WHERE message_id = ?").get("msg_ipc_1688");
      assert.equal(messageRow.topic, "alibaba.trade.order.success");
      assert.equal(messageRow.status, "processed");
      assert.ok(messageRow.processed_at);
      const messagePo = messageDb.prepare("SELECT external_order_status FROM erp_purchase_orders WHERE id = ?").get("po_ipc");
      assert.equal(messagePo.external_order_status, "success");
    } finally {
      messageDb.close();
    }

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
    assert.match(purchasePage.body, /pay_ipc/);

    const purchaseApi = await requestUrl(`${lanStatus.localUrl}/api/purchase/workbench`, {
      headers: { Cookie: cookie },
    });
    assert.equal(purchaseApi.statusCode, 200);
    const purchaseApiBody = JSON.parse(purchaseApi.body);
    assert.equal(purchaseApiBody.workbench.purchaseRequests[0].id, "pr_ipc");
    assert.equal(purchaseApiBody.workbench.purchaseOrders.some((item) => item.id === "po_ipc"), true);
    assert.equal(purchaseApiBody.workbench.purchaseOrders.some((item) => item.id === "po_delete_ipc"), false);
    assert.equal(purchaseApiBody.workbench.paymentQueue.some((item) => item.paymentApprovalId === "pay_ipc"), true);

    const opsCreateLogin = await requestUrl(`${lanStatus.localUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ login: "Ops", accessCode: "ops-code" }),
    });
    assert.equal(opsCreateLogin.statusCode, 200);
    const opsCreateCookie = Array.isArray(opsCreateLogin.headers["set-cookie"])
      ? opsCreateLogin.headers["set-cookie"][0]
      : opsCreateLogin.headers["set-cookie"];
    assert.ok(opsCreateCookie && opsCreateCookie.includes("temu_erp_lan_session"));

    const createPurchaseRequest = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: opsCreateCookie,
      },
      body: JSON.stringify({
        action: "create_pr",
        accountId: account.id,
        skuId: sku.id,
        requestedQty: 3,
        targetUnitCost: 12.5,
        specText: "红色 / 30cm / 2个装",
        reason: "fast create regression",
      }),
    });
    assert.equal(createPurchaseRequest.statusCode, 200);
    const createPurchaseRequestBody = JSON.parse(createPurchaseRequest.body).result;
    assert.equal(createPurchaseRequestBody.result.status, "submitted");
    const createdRequestRow = createPurchaseRequestBody.workbench.purchaseRequests.find((item) => item.id === createPurchaseRequestBody.result.id);
    assert.ok(createdRequestRow);
    assert.equal(createdRequestRow.specText, "红色 / 30cm / 2个装");
    assert.equal("skuOptions" in createPurchaseRequestBody.workbench, false);
    assert.equal("supplierOptions" in createPurchaseRequestBody.workbench, false);
    assert.equal("alibaba1688Addresses" in createPurchaseRequestBody.workbench, false);

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
      "approved_to_pay",
    );
    assert.ok(
      buyerActionBody.workbench.paymentQueue.some((item) => item.poId === "po_draft_ipc" && item.paymentApprovalStatus === "approved"),
    );

    const duplicateSubmitPayment = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "submit_payment_approval",
        poId: "po_draft_ipc",
        amount: 630,
      }),
    });
    assert.equal(duplicateSubmitPayment.statusCode, 200);
    const duplicateSubmitBody = JSON.parse(duplicateSubmitPayment.body).result.result;
    assert.equal(duplicateSubmitBody.idempotent, true);
    assert.equal(duplicateSubmitBody.transition.fromStatus, "approved_to_pay");
    assert.equal(duplicateSubmitBody.transition.toStatus, "approved_to_pay");
    assert.equal(duplicateSubmitBody.paymentApproval.status, "approved");

    const source1688 = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "source_1688_keyword",
        prId: "pr_ipc",
        keyword: "demo product",
        pageSize: 1,
        importLimit: 1,
        mockResults: [
          {
            offerId: "1688-offer-ipc",
            subject: "1688 API Candidate",
            price: "9.90",
            minOrderQuantity: 10,
            companyName: "1688 API Supplier",
            imageUrl: "https://example.test/1688-api.jpg",
          },
        ],
      }),
    });
    assert.equal(source1688.statusCode, 200);
    const source1688Result = JSON.parse(source1688.body).result;
    assert.equal(source1688Result.result.importedCount, 1);
    assert.equal(source1688Result.result.candidates[0].externalOfferId, "1688-offer-ipc");
    assert.equal(source1688Result.result.candidates[0].sourcingMethod, "official_api");
    const source1688CandidateId = source1688Result.result.candidates[0].id;

    const detail1688 = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "refresh_1688_product_detail",
        candidateId: source1688CandidateId,
        mockDetail: {
          result: {
            toReturn: {
              productID: "1688-offer-ipc",
              subject: "1688 API Candidate Detail",
              companyName: "1688 Detail Supplier",
              sellerMemberId: "b2b-test-member",
              sellerLoginId: "demo_factory",
              saleInfo: {
                priceRanges: [
                  { startQuantity: 1, price: "8.80" },
                  { startQuantity: 50, price: "7.70" },
                ],
              },
              skuInfos: [
                {
                  skuId: "sku-blue",
                  specId: "spec-blue",
                  price: "8.50",
                  attributes: [{ attributeName: "Color", value: "Blue" }],
                },
              ],
            },
          },
        },
      }),
    });
    assert.equal(detail1688.statusCode, 200);
    const detail1688Result = JSON.parse(detail1688.body).result.result;
    assert.equal(detail1688Result.candidate.externalSkuId, "sku-blue");
    assert.equal(detail1688Result.candidate.externalSpecId, "spec-blue");
    assert.equal(detail1688Result.candidate.unitPrice, 8.5);
    assert.equal(detail1688Result.candidate.externalSkuOptions[0].specText, "Color:Blue");
    assert.equal(detail1688Result.sku1688Source.externalOfferId, "1688-offer-ipc");
    assert.equal(detail1688Result.sku1688Source.externalSkuId, "sku-blue");
    assert.equal(detail1688Result.sku1688Source.externalSpecId, "spec-blue");
    assert.equal(detail1688Result.sku1688Source.isDefault, true);

    const mix1688 = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "query_1688_mix_config",
        sourceId: detail1688Result.sku1688Source.id,
        mockMixConfigResponse: {
          result: {
            toReturn: {
              generalHunpi: true,
              mixAmount: "100",
              mixNumber: 3,
              memberId: "b2b-test-member",
            },
          },
        },
      }),
    });
    assert.equal(mix1688.statusCode, 200);
    const mix1688Result = JSON.parse(mix1688.body).result.result;
    assert.equal(mix1688Result.query.sellerMemberId, "b2b-test-member");
    assert.equal(mix1688Result.query.sellerLoginId, "demo_factory");
    assert.equal(mix1688Result.mixConfig.generalHunpi, true);
    assert.equal(mix1688Result.sku1688Source.sourcePayload.marketingMixConfig.memberId, "b2b-test-member");

    const address1688 = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "save_1688_address",
        id: "addr_1688_ipc",
        accountId: account.id,
        label: "IPC Warehouse",
        fullName: "Receiver",
        mobile: "13800000000",
        provinceText: "Zhejiang",
        cityText: "Hangzhou",
        areaText: "Xihu",
        address: "No. 1 Test Road",
        postCode: "310000",
        isDefault: true,
      }),
    });
    assert.equal(address1688.statusCode, 200);
    const address1688Result = JSON.parse(address1688.body).result.result;
    assert.equal(address1688Result.id, "addr_1688_ipc");
    assert.equal(address1688Result.addressParam.fullName, "Receiver");

    const po1688 = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "generate_po",
        prId: "pr_ipc",
        candidateId: source1688CandidateId,
        poId: "po_1688_preview_ipc",
        poNo: "PO-1688-PREVIEW",
        qty: 60,
      }),
    });
    assert.equal(po1688.statusCode, 200);
    const po1688Result = JSON.parse(po1688.body).result.result;
    assert.equal(po1688Result.sku1688Source.externalOfferId, "1688-offer-ipc");
    assert.equal(po1688Result.sku1688Source.isDefault, true);
    const mappedSku = JSON.parse(po1688.body).result.workbench.skuOptions.find((item) => item.id === sku.id);
    assert.equal(mappedSku.procurementSourceCount, 1);
    assert.equal(mappedSku.primary1688Source.externalOfferId, "1688-offer-ipc");

    const missingRemoteAddressValidation = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "validate_1688_order_push",
        poId: "po_1688_preview_ipc",
        dryRun: true,
      }),
    });
    assert.equal(missingRemoteAddressValidation.statusCode, 400);
    assert.match(missingRemoteAddressValidation.body, /ADDRESS_REMOTE_ID_MISSING/);

    await invoke("erp:purchase:action", {
      action: "set_default_1688_purchase_account",
      accountId: account.id,
      default1688AccountId: "1688_auth_ipc_b",
      actor: { id: user.id, role: "admin" },
    });
    const officialAddressSync = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "sync_1688_addresses",
        mockResponse: {
          result: {
            receiveAddressItems: [{
              id: 560954849,
              fullName: "Receiver",
              address: "No. 1 Test Road",
              post: "310000",
              mobilePhone: "13800000000",
              addressCode: "330106",
              addressCodeText: "Zhejiang Hangzhou Xihu",
              townCode: "330106001",
              townName: "Test Town",
              isDefault: true,
            }],
          },
          success: true,
        },
      }),
    });
    assert.equal(officialAddressSync.statusCode, 200);
    const officialAddressSyncResult = JSON.parse(officialAddressSync.body).result.result;
    assert.equal(officialAddressSyncResult.addressCount, 1);
    assert.equal(officialAddressSyncResult.addresses[0].addressId, "560954849");
    assert.equal(officialAddressSyncResult.addresses[0].purchase1688AccountId, "1688_auth_ipc_b");

    const validateAfterOfficialAddressSync = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "validate_1688_order_push",
        poId: "po_1688_preview_ipc",
        dryRun: true,
      }),
    });
    assert.equal(validateAfterOfficialAddressSync.statusCode, 200);
    const validateAfterOfficialAddressSyncResult = JSON.parse(validateAfterOfficialAddressSync.body).result.result;
    assert.equal(validateAfterOfficialAddressSyncResult.ready, true);
    assert.equal(validateAfterOfficialAddressSyncResult.params.addressParam.addressId, "560954849");

    const syncedAddress1688 = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "save_1688_address",
        id: "addr_1688_ipc",
        accountId: account.id,
        label: "IPC Warehouse",
        fullName: "Receiver",
        mobile: "13800000000",
        provinceText: "Zhejiang",
        cityText: "Hangzhou",
        areaText: "Xihu",
        address: "No. 1 Test Road",
        postCode: "310000",
        alibabaAddressId: "remote-addr-ipc",
        isDefault: true,
      }),
    });
    assert.equal(syncedAddress1688.statusCode, 200);
    const syncedAddress1688Result = JSON.parse(syncedAddress1688.body).result.result;
    assert.equal(syncedAddress1688Result.addressParam.addressId, "remote-addr-ipc");

    const createOptimizationRequest = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: opsCreateCookie,
      },
      body: JSON.stringify({
        action: "create_pr",
        accountId: account.id,
        skuId: sku.id,
        requestedQty: 2,
        targetUnitCost: 7.5,
        specText: "lower cost supplier",
        reason: "optimization - cost target",
      }),
    });
    assert.equal(createOptimizationRequest.statusCode, 200);
    const createOptimizationRequestBody = JSON.parse(createOptimizationRequest.body).result;
    const createdOptimizationRow = createOptimizationRequestBody.workbench.purchaseRequests.find(
      (item) => item.id === createOptimizationRequestBody.result.id,
    );
    assert.ok(createdOptimizationRow);
    assert.equal(createdOptimizationRow.reason, "optimization - cost target");
    assert.equal(createdOptimizationRow.status, "submitted");
    assert.ok(Number(createdOptimizationRow.mappingCount || 0) > 0);
    assert.equal(
      createOptimizationRequestBody.workbench.purchaseOrders.some((item) => item.prId === createdOptimizationRow.id),
      false,
    );

    const preview1688 = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "preview_1688_order",
        poId: "po_1688_preview_ipc",
        mockPreviewResponse: {
          result: {
            toReturn: {
              totalAmount: "512.00",
              freight: "2.00",
            },
          },
        },
      }),
    });
    assert.equal(preview1688.statusCode, 200);
    const preview1688Result = JSON.parse(preview1688.body).result.result;
    assert.equal(preview1688Result.preview.totalAmount, 512);
    assert.equal(preview1688Result.purchaseOrder.externalOrderStatus, "previewed");
    assert.equal(preview1688Result.purchaseOrder.externalOrderPreviewedAt.length > 0, true);

    const validate1688Push = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "validate_1688_order_push",
        poId: "po_1688_preview_ipc",
        dryRun: true,
      }),
    });
    assert.equal(validate1688Push.statusCode, 200);
    const validate1688PushResult = JSON.parse(validate1688Push.body).result.result;
    assert.equal(validate1688PushResult.ready, true);
    assert.equal(validate1688PushResult.cargoCount, 1);

    const push1688 = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "push_1688_order",
        poId: "po_1688_preview_ipc",
        mockResponse: {
          result: {
            orderId: "1688-pushed-ipc",
          },
        },
      }),
    });
    assert.equal(push1688.statusCode, 200);
    const push1688Result = JSON.parse(push1688.body).result.result;
    assert.equal(push1688Result.externalOrderId, "1688-pushed-ipc");
    assert.equal(push1688Result.purchaseOrder.status, "pushed_pending_price");
    assert.equal(push1688Result.purchaseOrder.externalOrderStatus, "created");

    const sync1688Order = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "sync_1688_orders",
        poId: "po_1688_preview_ipc",
        mockOrderListResponse: {
          result: {
            data: {
              orderList: [
                {
                  tradeId: "1688-order-ipc",
                  orderStatus: "waitbuyerpay",
                  sellerCompanyName: "1688 Detail Supplier",
                  totalAmount: "510.00",
                  createTime: "2026-04-29 16:00:00",
                  products: [
                    {
                      offerId: "1688-offer-ipc",
                      skuId: "sku-blue",
                      specId: "spec-blue",
                      quantity: 60,
                    },
                  ],
                },
                {
                  tradeId: "1688-order-ipc-alt",
                  orderStatus: "waitsellerpush",
                  sellerCompanyName: "1688 Detail Supplier",
                  totalAmount: "510.00",
                  createTime: "2026-04-29 16:05:00",
                  products: [
                    {
                      offerId: "1688-offer-ipc",
                      skuId: "sku-blue",
                      specId: "spec-blue",
                      quantity: 60,
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
    });
    assert.equal(sync1688Order.statusCode, 200);
    const sync1688OrderResult = JSON.parse(sync1688Order.body).result.result;
    assert.equal(sync1688OrderResult.matchStatus, "needs_confirmation");
    assert.equal(sync1688OrderResult.matchedCount, 2);

    const bind1688Order = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "sync_1688_orders",
        poId: "po_1688_preview_ipc",
        externalOrderId: "1688-order-ipc-alt",
        mockOrderListResponse: {
          result: {
            data: {
              orderList: [
                {
                  tradeId: "1688-order-ipc",
                  orderStatus: "waitbuyerpay",
                  sellerCompanyName: "1688 Detail Supplier",
                  totalAmount: "510.00",
                  products: [{ offerId: "1688-offer-ipc", skuId: "sku-blue", specId: "spec-blue", quantity: 60 }],
                },
                {
                  tradeId: "1688-order-ipc-alt",
                  orderStatus: "waitsellerpush",
                  sellerCompanyName: "1688 Detail Supplier",
                  totalAmount: "510.00",
                  products: [{ offerId: "1688-offer-ipc", skuId: "sku-blue", specId: "spec-blue", quantity: 60 }],
                },
              ],
            },
          },
        },
      }),
    });
    assert.equal(bind1688Order.statusCode, 200);
    const bind1688OrderResult = JSON.parse(bind1688Order.body).result.result;
    assert.equal(bind1688OrderResult.matchStatus, "bound");
    assert.equal(bind1688OrderResult.externalOrderId, "1688-order-ipc-alt");
    assert.equal(bind1688OrderResult.purchaseOrder.externalOrderId, "1688-order-ipc-alt");
    assert.equal(bind1688OrderResult.purchaseOrder.externalOrderStatus, "waitsellerpush");

    const batchPayDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      const now = new Date().toISOString();
      batchPayDb.prepare(`
        INSERT INTO erp_purchase_orders (
          id, account_id, pr_id, selected_candidate_id, supplier_id, po_no,
          status, payment_status, expected_delivery_date, total_amount, paid_amount,
          external_order_id, external_order_status,
          created_by, created_at, updated_at
        )
        VALUES (
          'po_1688_batch_pay_ipc', @account_id, 'pr_ipc', 'candidate_ipc', @supplier_id,
          'PO-1688-BATCH-PAY', 'pushed_pending_price', 'unpaid',
          '2026-05-20', 88, 90, '1688-order-ipc-batch', 'waitbuyerpay',
          @buyer_id, @now, @now
        )
      `).run({
        account_id: account.id,
        supplier_id: supplier.id,
        buyer_id: buyer.id,
        now,
      });
    } finally {
      batchPayDb.close();
    }

    const batchPaymentUrl = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "get_1688_payment_url",
        poIds: ["po_1688_preview_ipc", "po_1688_batch_pay_ipc"],
        mockPaymentResponse: {
          result: {
            payUrl: "https://pay.1688.test/batch?orders=2",
          },
        },
      }),
    });
    assert.equal(batchPaymentUrl.statusCode, 200);
    const batchPaymentUrlResult = JSON.parse(batchPaymentUrl.body).result.result;
    assert.equal(batchPaymentUrlResult.paymentUrl, "https://pay.1688.test/batch?orders=2");
    assert.deepEqual(
      [...batchPaymentUrlResult.query.orderIdList].sort(),
      ["1688-order-ipc-alt", "1688-order-ipc-batch"].sort(),
    );
    assert.equal(batchPaymentUrlResult.purchaseOrders.length, 2);
    const batchPaymentDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      const savedUrls = batchPaymentDb.prepare(`
        SELECT external_payment_url
        FROM erp_purchase_orders
        WHERE id IN ('po_1688_preview_ipc', 'po_1688_batch_pay_ipc')
        ORDER BY id
      `).all().map((row) => row.external_payment_url);
      assert.deepEqual(savedUrls, [
        "https://pay.1688.test/batch?orders=2",
        "https://pay.1688.test/batch?orders=2",
      ]);
    } finally {
      batchPaymentDb.close();
    }

    const createRefundDryRun = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "create_1688_refund",
        poId: "po_1688_preview_ipc",
        refundType: "refund",
        goodsStatus: "received",
        amount: 4.26,
        refundReasonId: "reason-ipc",
        reason: "not needed",
        dryRun: true,
      }),
    });
    assert.equal(createRefundDryRun.statusCode, 200);
    const createRefundParams = JSON.parse(createRefundDryRun.body).result.result.params;
    assert.equal(createRefundParams.orderId, "1688-order-ipc-alt");
    assert.equal(createRefundParams.applyPayment, 426);
    assert.equal(createRefundParams.refundPayment, 426);
    assert.equal(createRefundParams.applyCarriage, 0);
    assert.equal(createRefundParams.input.applyCarriage, 0);

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

    const duplicateSubmitPaid = await requestUrl(`${lanStatus.localUrl}/api/purchase/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: financeCookie,
      },
      body: JSON.stringify({
        action: "submit_payment_approval",
        poId: "po_ipc",
        amount: 100,
      }),
    });
    assert.equal(duplicateSubmitPaid.statusCode, 200);
    const duplicateSubmitPaidBody = JSON.parse(duplicateSubmitPaid.body).result.result;
    assert.equal(duplicateSubmitPaidBody.idempotent, true);
    assert.equal(duplicateSubmitPaidBody.transition.fromStatus, "paid");
    assert.equal(duplicateSubmitPaidBody.transition.toStatus, "paid");
    assert.equal(duplicateSubmitPaidBody.paymentApproval.status, "paid");

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

    const warehouseAfterRegister = await requestUrl(`${lanStatus.localUrl}/api/warehouse/workbench`, {
      headers: {
        Cookie: warehouseCookie,
      },
    });
    assert.equal(warehouseAfterRegister.statusCode, 200);
    const warehouseAfterArrival = JSON.parse(warehouseAfterRegister.body).workbench;
    assert.equal(
      warehouseAfterArrival.inboundReceipts.find((item) => item.id === "inbound_wh_ipc").status,
      "arrived",
    );
    assert.equal(warehouseAfterArrival.inventoryBatches.length, 0);

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

    const warehouseAfterCount = await requestUrl(`${lanStatus.localUrl}/api/warehouse/workbench`, {
      headers: {
        Cookie: warehouseCookie,
      },
    });
    assert.equal(warehouseAfterCount.statusCode, 200);
    const warehouseAfterCountBody = JSON.parse(warehouseAfterCount.body).workbench;
    assert.equal(
      warehouseAfterCountBody.inboundReceipts.find((item) => item.id === "inbound_wh_ipc").status,
      "counted",
    );
    assert.equal(warehouseAfterCountBody.inventoryBatches.length, 0);

    const confirmInbound = await requestUrl(`${lanStatus.localUrl}/api/warehouse/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: warehouseCookie,
      },
      body: new URLSearchParams({
        action: "confirm_inbound",
        receiptId: "inbound_wh_ipc",
      }).toString(),
    });
    assert.equal(confirmInbound.statusCode, 302);

    const warehouseAfterInbound = await requestUrl(`${lanStatus.localUrl}/api/warehouse/workbench`, {
      headers: {
        Cookie: warehouseCookie,
      },
    });
    assert.equal(warehouseAfterInbound.statusCode, 200);
    const warehouseAfterBatches = JSON.parse(warehouseAfterInbound.body).workbench;
    assert.equal(
      warehouseAfterBatches.inboundReceipts.find((item) => item.id === "inbound_wh_ipc").status,
      "inbounded_pending_qc",
    );
    assert.equal(warehouseAfterBatches.inventoryBatches.length, 1);
    const autoBatch = warehouseAfterBatches.inventoryBatches.find((item) => item.inboundReceiptId === "inbound_wh_ipc");
    assert.ok(autoBatch?.id);
    const qcBatchId = autoBatch.id;
    assert.equal(autoBatch.receivedQty, 40);

    // 已去掉入库 QC 闸门：入库后数量直接进可用桶、qc_status=passed。
    assert.equal(autoBatch.blockedQty, 0);
    assert.equal(autoBatch.availableQty, 40);

    const purchaseAfterInbound = await requestUrl(`${lanStatus.localUrl}/api/purchase/workbench`, {
      headers: { Cookie: cookie },
    });
    assert.equal(purchaseAfterInbound.statusCode, 200);
    assert.equal(
      JSON.parse(purchaseAfterInbound.body).workbench.purchaseOrders.find((item) => item.id === "po_wh_ipc").status,
      "inbounded",
    );

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

    // QC 路由与 RBAC 仍在（仅去掉了入库→出库之间的强制闸门），ops 可访问；
    // 但入库已不再产生待质检批次，QC 工作台恒为空。
    const qcPage = await requestUrl(`${lanStatus.localUrl}/qc`, {
      headers: { Cookie: opsCookie },
    });
    assert.equal(qcPage.statusCode, 200);

    const qcWorkbench = await requestUrl(`${lanStatus.localUrl}/api/qc/workbench`, {
      headers: { Cookie: opsCookie },
    });
    assert.equal(qcWorkbench.statusCode, 200);
    const qcWorkbenchBody = JSON.parse(qcWorkbench.body).workbench;
    assert.equal(qcWorkbenchBody.pendingBatches.length, 0);

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
    assert.equal(outboundWorkbenchBody.availableBatches[0].availableQty, 40);

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
      30,
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

    const createCloudStockOutbound = await requestUrl(`${lanStatus.localUrl}/api/outbound/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: opsCookie,
      },
      body: JSON.stringify({
        action: "create_outbound_plan_from_temu_stock_order",
        accountId: account.id,
        stockOrder: {
          id: "cloud-stock-order-ipc",
          stock_order_no: "SO-IPC-001",
          delivery_order_sn: "DO-IPC-001",
          delivery_batch_sn: "DB-IPC-001",
          product_id: "PROD-IPC-001",
          skc_id: "SKC-IPC-001",
          sku_id: "SKU-TEMU-IPC",
          sku_ext_code: "SKU-IPC-001",
          product_name: "IPC Demo SKU",
          spec_name: "White / Standard",
          demand_qty: 6,
          delivered_qty: 0,
        },
        qty: 6,
        boxes: 1,
      }),
    });
    assert.equal(createCloudStockOutbound.statusCode, 200);
    const createCloudStockOutboundBody = JSON.parse(createCloudStockOutbound.body).result;
    const cloudOutboundShipment = createCloudStockOutboundBody.result.shipment;
    assert.equal(cloudOutboundShipment.temuStockOrderNo, "SO-IPC-001");
    assert.equal(cloudOutboundShipment.temuDeliveryOrderSn, "DO-IPC-001");
    assert.equal(cloudOutboundShipment.temuDeliveryBatchSn, "DB-IPC-001");
    assert.equal(cloudOutboundShipment.temuSyncStatus, "cloud_stock_order_outbound_created");
    assert.equal(cloudOutboundShipment.status, "pending_warehouse");
    assert.equal(
      createCloudStockOutboundBody.workbench.availableBatches.find((item) => item.id === qcBatchId).availableQty,
      24,
    );
    assert.equal(
      createCloudStockOutboundBody.workbench.outboundShipments.filter((item) => item.temuStockOrderNo === "SO-IPC-001").length,
      1,
    );

    const duplicateCloudStockOutbound = await requestUrl(`${lanStatus.localUrl}/api/outbound/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: opsCookie,
      },
      body: JSON.stringify({
        action: "create_outbound_plan_from_temu_stock_order",
        accountId: account.id,
        stockOrder: {
          id: "cloud-stock-order-ipc",
          stock_order_no: "SO-IPC-001",
          delivery_order_sn: "DO-IPC-001",
          delivery_batch_sn: "DB-IPC-001",
          product_id: "PROD-IPC-001",
          skc_id: "SKC-IPC-001",
          sku_id: "SKU-TEMU-IPC",
          sku_ext_code: "SKU-IPC-001",
          product_name: "IPC Demo SKU",
          spec_name: "White / Standard",
          demand_qty: 6,
          delivered_qty: 0,
        },
        qty: 6,
        boxes: 1,
      }),
    });
    assert.equal(duplicateCloudStockOutbound.statusCode, 200);
    const duplicateCloudStockOutboundBody = JSON.parse(duplicateCloudStockOutbound.body).result;
    assert.equal(duplicateCloudStockOutboundBody.result.idempotent, true);
    assert.equal(duplicateCloudStockOutboundBody.result.createdQty, 0);
    assert.equal(
      duplicateCloudStockOutboundBody.workbench.outboundShipments.filter((item) => item.temuStockOrderNo === "SO-IPC-001").length,
      1,
    );
    assert.equal(
      duplicateCloudStockOutboundBody.workbench.availableBatches.find((item) => item.id === qcBatchId).availableQty,
      24,
    );

    const multiSku = await invoke("erp:sku:create", {
      id: "sku_multi_ipc",
      accountId: account.id,
      internalSkuCode: "SKU-MULTI-IPC",
      temuProductId: "PROD-MULTI-IPC",
      temuSkcId: "SKC-MULTI-IPC",
      temuSkuId: "SKU-TEMU-MULTI-IPC",
      productName: "IPC Multi Batch SKU",
      colorSpec: "Multi / Standard",
      supplierId: supplier.id,
    });
    const multiBatchSeedDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      const multiBatchServices = createErpServices(multiBatchSeedDb);
      multiBatchServices.inventory.createBatchFromInbound({
        id: "batch_multi_ipc_a",
        accountId: account.id,
        batchCode: "BATCH-MULTI-A",
        skuId: multiSku.id,
        receivedQty: 3,
        unitLandedCost: 2.1,
        locationCode: "M-A",
        receivedAt: "2026-05-20T01:00:00.000Z",
        actor: { id: warehouseUser.id, role: warehouseUser.role },
      });
      multiBatchServices.inventory.createBatchFromInbound({
        id: "batch_multi_ipc_b",
        accountId: account.id,
        batchCode: "BATCH-MULTI-B",
        skuId: multiSku.id,
        receivedQty: 4,
        unitLandedCost: 2.2,
        locationCode: "M-B",
        receivedAt: "2026-05-21T01:00:00.000Z",
        actor: { id: warehouseUser.id, role: warehouseUser.role },
      });
    } finally {
      multiBatchSeedDb.close();
    }

    const multiStockOrder = {
      id: "cloud-stock-order-multi-ipc",
      stock_order_no: "SO-IPC-MULTI",
      delivery_order_sn: "DO-IPC-MULTI",
      delivery_batch_sn: "DB-IPC-MULTI",
      product_id: "PROD-MULTI-IPC",
      skc_id: "SKC-MULTI-IPC",
      sku_id: "SKU-TEMU-MULTI-IPC",
      sku_ext_code: "SKU-MULTI-IPC",
      product_name: "IPC Multi Batch SKU",
      spec_name: "Multi / Standard",
      demand_qty: 5,
      delivered_qty: 0,
    };
    const previewMultiCloudStockOutbound = await requestUrl(`${lanStatus.localUrl}/api/outbound/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: opsCookie,
      },
      body: JSON.stringify({
        action: "preview_temu_stock_order_outbound",
        accountId: account.id,
        stockOrder: multiStockOrder,
        qty: 5,
      }),
    });
    assert.equal(previewMultiCloudStockOutbound.statusCode, 200);
    const previewMultiCloudStockOutboundBody = JSON.parse(previewMultiCloudStockOutbound.body).result.result;
    assert.equal(previewMultiCloudStockOutboundBody.allocationPlan.length, 2);
    assert.equal(previewMultiCloudStockOutboundBody.availableQty, 7);
    assert.equal(previewMultiCloudStockOutboundBody.remainingQty, 5);
    assert.equal(previewMultiCloudStockOutboundBody.shortageQty, 0);

    const createMultiCloudStockOutbound = await requestUrl(`${lanStatus.localUrl}/api/outbound/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: opsCookie,
      },
      body: JSON.stringify({
        action: "create_outbound_plan_from_temu_stock_order",
        accountId: account.id,
        stockOrder: multiStockOrder,
        qty: 5,
        boxes: 1,
      }),
    });
    assert.equal(createMultiCloudStockOutbound.statusCode, 200);
    const createMultiCloudStockOutboundBody = JSON.parse(createMultiCloudStockOutbound.body).result;
    assert.equal(createMultiCloudStockOutboundBody.result.idempotent, false);
    assert.equal(createMultiCloudStockOutboundBody.result.createdQty, 5);
    assert.equal(createMultiCloudStockOutboundBody.result.createdShipments.length, 2);
    assert.equal(
      createMultiCloudStockOutboundBody.workbench.outboundShipments.filter((item) => item.temuStockOrderNo === "SO-IPC-MULTI").length,
      2,
    );
    const multiBatchCheckDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      const batchA = multiBatchCheckDb.prepare("SELECT available_qty, reserved_qty FROM erp_inventory_batches WHERE id = ?").get("batch_multi_ipc_a");
      const batchB = multiBatchCheckDb.prepare("SELECT available_qty, reserved_qty FROM erp_inventory_batches WHERE id = ?").get("batch_multi_ipc_b");
      assert.equal(batchA.available_qty, 0);
      assert.equal(batchA.reserved_qty, 3);
      assert.equal(batchB.available_qty, 2);
      assert.equal(batchB.reserved_qty, 2);
    } finally {
      multiBatchCheckDb.close();
    }

    const partialRegisterArrival = await requestUrl(`${lanStatus.localUrl}/api/warehouse/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: warehouseCookie,
      },
      body: JSON.stringify({
        action: "register_arrival",
        receiptId: "inbound_partial_ipc",
      }),
    });
    assert.equal(partialRegisterArrival.statusCode, 200);
    assert.equal(
      JSON.parse(partialRegisterArrival.body).result.workbench.inboundReceipts.find((item) => item.id === "inbound_partial_ipc").status,
      "arrived",
    );

    const partialInbound = await requestUrl(`${lanStatus.localUrl}/api/warehouse/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: warehouseCookie,
      },
      body: JSON.stringify({
        action: "confirm_count",
        receiptId: "inbound_partial_ipc",
        lines: [
          {
            id: "inbound_line_partial_ipc",
            received_qty: 6,
            damaged_qty: 1,
          },
        ],
      }),
    });
    assert.equal(partialInbound.statusCode, 200);
    const partialWarehouseBody = JSON.parse(partialInbound.body).result.workbench;
    assert.equal(
      partialWarehouseBody.inboundReceipts.find((item) => item.id === "inbound_partial_ipc").status,
      "damaged",
    );
    assert.equal(
      partialWarehouseBody.inventoryBatches.some((item) => item.inboundReceiptId === "inbound_partial_ipc"),
      false,
    );

    const purchaseAfterPartialInbound = await requestUrl(`${lanStatus.localUrl}/api/purchase/workbench`, {
      headers: { Cookie: cookie },
    });
    assert.equal(purchaseAfterPartialInbound.statusCode, 200);
    const partialPo = JSON.parse(purchaseAfterPartialInbound.body).workbench.purchaseOrders.find((item) => item.id === "po_partial_ipc");
    assert.equal(partialPo.status, "arrived");
    assert.equal(partialPo.receivedQty, 6);

    const ratioSku = await invoke("erp:sku:create", {
      id: "sku_ratio_ipc",
      accountId: account.id,
      internalSkuCode: "SKU-RATIO-IPC",
      productName: "IPC Ratio Mapping SKU",
      colorSpec: "Ratio / Standard",
      supplierId: supplier.id,
    });
    const ratioMapping = await invoke("erp:purchase:action", {
      action: "upsert_sku_1688_source",
      actor: { id: buyer.id, role: buyer.role },
      skuId: ratioSku.id,
      accountId: account.id,
      mappingGroupId: "map_ratio_ipc",
      externalOfferId: "1688-offer-ratio-ipc",
      externalSkuId: "sku-ratio",
      externalSpecId: "spec-ratio",
      platformSkuName: "Ratio / 1688",
      supplierName: supplier.name,
      productTitle: "IPC Ratio 1688 Product",
      productUrl: "https://detail.1688.com/offer/1688-offer-ratio-ipc.html",
      unitPrice: 8,
      moq: 1,
      ourQty: 2,
      platformQty: 5,
      isDefault: true,
      includeWorkbench: false,
    });
    assert.equal(ratioMapping.result.sku1688Source.ourQty, 2);
    assert.equal(ratioMapping.result.sku1688Source.platformQty, 5);
    const ratioSecondMapping = await invoke("erp:purchase:action", {
      action: "upsert_sku_1688_source",
      actor: { id: buyer.id, role: buyer.role },
      skuId: ratioSku.id,
      accountId: account.id,
      mappingGroupId: "map_ratio_ipc",
      externalOfferId: "1688-offer-ratio-ipc",
      externalSkuId: "sku-ratio-red",
      externalSpecId: "spec-ratio-red",
      platformSkuName: "Ratio / 1688 Red",
      supplierName: supplier.name,
      productTitle: "IPC Ratio 1688 Product",
      productUrl: "https://detail.1688.com/offer/1688-offer-ratio-ipc.html",
      unitPrice: 8.5,
      moq: 1,
      ourQty: 2,
      platformQty: 7,
      isDefault: false,
      includeWorkbench: false,
    });
    assert.equal(ratioSecondMapping.result.sku1688Source.mappingGroupId, "map_ratio_ipc");
    assert.equal(ratioSecondMapping.result.sku1688Source.platformQty, 7);

    const ratioPr = await invoke("erp:purchase:action", {
      action: "create_pr",
      actor: { id: user.id, role: user.role },
      accountId: account.id,
      skuId: ratioSku.id,
      requestedQty: 4,
      targetUnitCost: 8,
      reason: "1688 ratio mapping regression",
      includeWorkbench: false,
    });
    const ratioPo = await invoke("erp:purchase:action", {
      action: "generate_po",
      actor: { id: buyer.id, role: buyer.role },
      prId: ratioPr.result.id,
      preferSku1688Source: true,
      qty: 4,
      poId: "po_ratio_ipc",
      poNo: "PO-RATIO-IPC",
      includeWorkbench: false,
    });
    assert.equal(ratioPo.result.sku1688Source.ourQty, 2);
    assert.equal(ratioPo.result.sku1688Source.platformQty, 5);

    const duplicatePoNoPr = await invoke("erp:purchase:action", {
      action: "create_pr",
      actor: { id: user.id, role: user.role },
      accountId: account.id,
      skuId: ratioSku.id,
      requestedQty: 2,
      targetUnitCost: 8,
      reason: "duplicate po no regression",
      includeWorkbench: false,
    });
    const duplicatePoNoResult = await invoke("erp:purchase:action", {
      action: "generate_po",
      actor: { id: buyer.id, role: buyer.role },
      prId: duplicatePoNoPr.result.id,
      preferSku1688Source: true,
      qty: 2,
      poId: "po_duplicate_no_ipc",
      poNo: "PO-RATIO-IPC",
      includeWorkbench: false,
    });
    assert.notEqual(duplicatePoNoResult.result.purchaseOrder.poNo, "PO-RATIO-IPC");
    assert.match(duplicatePoNoResult.result.purchaseOrder.poNo, /^\d{6}$/);

    const ratioValidation = await invoke("erp:purchase:action", {
      action: "validate_1688_order_push",
      actor: { id: buyer.id, role: buyer.role },
      poId: "po_ratio_ipc",
      dryRun: true,
      includeWorkbench: false,
    });
    assert.equal(ratioValidation.result.ready, true);
    assert.equal(ratioValidation.result.params.cargoParamList.length, 2);
    assert.equal(ratioValidation.result.params.cargoParamList[0].quantity, 10);
    assert.equal(ratioValidation.result.params.cargoParamList[1].quantity, 14);

    const ratioDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      const row = ratioDb.prepare("SELECT our_qty, platform_qty, mapping_group_id FROM erp_sku_1688_sources WHERE id = ?").get(ratioMapping.result.sku1688Source.id);
      assert.equal(row.our_qty, 2);
      assert.equal(row.platform_qty, 5);
      assert.equal(row.mapping_group_id, "map_ratio_ipc");
      const groupedRows = ratioDb.prepare(`
        SELECT external_spec_id, platform_qty
        FROM erp_sku_1688_sources
        WHERE mapping_group_id = ?
      `).all("map_ratio_ipc");
      const platformQtyBySpecId = new Map(groupedRows.map((sourceRow) => [sourceRow.external_spec_id, sourceRow.platform_qty]));
      assert.equal(platformQtyBySpecId.get("spec-ratio"), 5);
      assert.equal(platformQtyBySpecId.get("spec-ratio-red"), 7);
      const groupedCount = ratioDb.prepare("SELECT COUNT(*) AS count FROM erp_sku_1688_sources WHERE mapping_group_id = ?").get("map_ratio_ipc").count;
      assert.equal(groupedCount, 2);
    } finally {
      ratioDb.close();
    }

    const operationLogDb = openErpDatabase({ userDataDir: tempUserData });
    try {
      const eventTypes = new Set(operationLogDb.prepare(`
        SELECT event_type
        FROM erp_purchase_request_events
        WHERE pr_id = 'pr_ipc'
      `).all().map((row) => row.event_type));
      for (const eventType of [
        "delete_po",
        "accept_request",
        "mark_sourced",
        "submit_payment_approval",
        "refresh_1688_product_detail",
        "generate_po",
        "preview_1688_order",
        "push_1688_order",
        "sync_1688_orders",
        "approve_payment",
        "confirm_paid",
        "auto_create_inbound_receipt",
        "register_arrival",
        "confirm_count",
        "mark_arrived",
        "mark_inbounded",
        "create_outbound_plan",
        "submit_outbound",
        "start_picking",
        "mark_packed",
        "confirm_shipped_out",
        "request_ops_confirm",
        "confirm_outbound_done",
      ]) {
        assert.ok(eventTypes.has(eventType), `missing purchase request event: ${eventType}`);
      }

      const operationEvents = operationLogDb.prepare(`
        SELECT event_type, actor_id, actor_name, actor_role, message
        FROM erp_purchase_request_events
        WHERE pr_id = 'pr_ipc'
      `).all();
      for (const row of operationEvents) {
        assert.ok(row.actor_role, `missing actor role for event: ${row.event_type}`);
        assert.ok(
          row.actor_name || row.actor_id || row.actor_role,
          `missing operator identity for event: ${row.event_type}`,
        );
        assert.ok(row.message, `missing event message: ${row.event_type}`);
      }

      const auditActions = new Set(operationLogDb.prepare(`
        SELECT action
        FROM erp_audit_logs
      `).all().map((row) => row.action));
      for (const action of [
        "submit_payment_approval",
        "create_payment_approval",
        "approve_payment",
        "approve_payment_approval",
        "confirm_paid",
        "confirm_payment_paid",
        "auto_create_inbound_receipt",
        "preview_1688_order",
        "push_1688_order",
        "register_arrival",
        "confirm_count",
        "create_outbound_plan",
        "submit_outbound",
        "start_picking",
        "mark_packed",
        "confirm_shipped_out",
        "request_ops_confirm",
        "confirm_outbound_done",
      ]) {
        assert.ok(auditActions.has(action), `missing audit action: ${action}`);
      }

      const ledgerTypes = new Set(operationLogDb.prepare(`
        SELECT type
        FROM erp_inventory_ledger_entries
        WHERE source_doc_type IN ('inbound_receipt', 'outbound_shipment')
      `).all().map((row) => row.type));
      for (const type of ["purchase_inbound", "outbound_reserve", "outbound_to_temu"]) {
        assert.ok(ledgerTypes.has(type), `missing inventory ledger type: ${type}`);
      }
    } finally {
      operationLogDb.close();
    }

    lanStatus = await invoke("erp:lan:stop");
    assert.equal(lanStatus.running, false);

    console.log("ERP Electron API check passed");
  } finally {
    closeErp();
    fs.rmSync(tempUserData, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
