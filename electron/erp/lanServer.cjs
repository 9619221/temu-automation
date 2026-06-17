const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const DEFAULT_LAN_PORT = 19380;
const DEFAULT_BIND_ADDRESS = "0.0.0.0";
const SESSION_COOKIE_NAME = "temu_erp_lan_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PURCHASE_WB_CACHE_TTL_MS = 30_000;
const PURCHASE_WB_STALE_TTL_MS = 120_000;
const _purchaseWbCache = new Map();
const _purchaseWbInflight = new Map();
let _purchaseWbGate = Promise.resolve();
function _purchaseWbCacheKey(payload, user) {
  const key = JSON.stringify({ p: payload, u: user?.companyId || "" });
  return key.length > 256 ? crypto.createHash("md5").update(key).digest("hex") : key;
}
function _clearPurchaseWbCache() { _purchaseWbCache.clear(); }
// 透传快路是否启用：查询池开 + 未启用店铺数据隔离（store-scope 需对象出口裁剪，与字符串透传互斥）。
// 启动期常量级判断，保证同进程缓存只用一种格式（透传存 {json}，对象路径存 {data}），不混。
function _poolStringTransportEnabled() {
  const poolOn = ["1", "true", "on", "yes"].includes(String(process.env.ERP_QUERY_POOL || "").toLowerCase());
  return poolOn && process.env.ENFORCE_STORE_SCOPE !== "1";
}
async function prewarmPurchaseWorkbench(getPurchaseWorkbenchFn, queryPool = null) {
  const payload = { limit: 2000, includeRequestDetails: false, includeOptions: false, include1688Meta: false };
  const cacheKey = _purchaseWbCacheKey(payload, null);
  // 透传模式 + 有池：18MB 大查询走 worker，主线程不阻塞（治本 prewarm 启动期裸跑卡全站，
  // 实测主线程 4.2s、冷态争盘可膨胀到 64s）。worker 出串直接拼接存 {json}。
  if (queryPool && _poolStringTransportEnabled()) {
    const wbStr = await queryPool.run("purchase_workbench", payload);
    const json = '{"ok":true,"workbench":' + wbStr + '}';
    _purchaseWbCache.set(cacheKey, { json, ts: Date.now(), len: json.length });
    return json.length;
  }
  // 无池/降级/store-scope：主线程直跑（原逻辑）。缓存格式须与路由读取端一致：透传读 {json}、对象读 {data}。
  const workbench = await getPurchaseWorkbenchFn(payload);
  if (_poolStringTransportEnabled()) {
    const json = '{"ok":true,"workbench":' + JSON.stringify(workbench) + '}';
    _purchaseWbCache.set(cacheKey, { json, ts: Date.now(), len: json.length });
    return json.length;
  }
  const body = { ok: true, workbench };
  const bodyText = JSON.stringify(body);
  _purchaseWbCache.set(cacheKey, { data: body, ts: Date.now(), len: bodyText.length });
  return bodyText.length;
}

const ROLE_PERMISSIONS = Object.freeze({
  "/": ["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"],
  "/users": ["admin", "manager"],
  "/api/users/list": ["admin", "manager"],
  "/api/users/upsert": ["admin", "manager"],
  "/api/companies/list": ["admin", "manager"],
  "/api/permissions/profile": ["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"],
  "/api/permissions/role/upsert": ["admin", "manager"],
  "/api/permissions/scope/upsert": ["admin", "manager"],
  "/api/permissions/admin-view": ["admin", "manager"],
  "/api/permissions/role/set-access": ["admin", "manager"],
  "/api/permissions/user/set-overrides": ["admin", "manager"],
  "/api/permissions/user/set-scopes": ["admin", "manager"],
  "/api/master-data/workbench": ["admin", "manager", "operations", "buyer"],
  "/api/master-data/sku-ids": ["admin", "manager", "operations", "buyer"],
  "/api/master-data/sku-stock-details": ["admin", "manager", "operations", "buyer", "warehouse"],
  "/api/master-data/supplier-goods": ["admin", "manager", "operations", "buyer"],
  "/api/master-data/mappings": ["admin", "manager", "operations", "buyer"],
  "/api/master-data/mapping-ids": ["admin", "manager", "operations", "buyer"],
  "/api/master-data/purchase-returns": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/master-data/purchase-return-ids": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/master-data/purchase-return-items": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/master-data/purchase-return-item-ids": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/master-data/purchase-return/action": ["admin", "manager", "operations", "buyer"],
  "/api/master-data/consign-after-sales": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/consign-after-sale-ids": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/consign-after-sale-items": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/consign-after-sale-item-ids": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/consign-deliveries": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/consign-deliver-items": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/consign-deliver-cloud-items": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/consign-deliveries-status": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/consign-deliveries-unified": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/other-inout": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/other-inout-items": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/other-inout-status": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/master-data/action": ["admin", "manager", "operations", "buyer"],
  "/1688": ["admin", "manager"],
  "/api/1688/status": ["admin", "manager"],
  "/api/1688/config": ["admin", "manager"],
  "/api/1688/token": ["admin", "manager"],
  "/api/1688/start": ["admin", "manager"],
  "/api/1688/refresh": ["admin", "manager"],
  "/api/1688/accounts/delete": ["admin", "manager"],
  "/api/temu/openapi/status": ["admin", "manager", "buyer"],
  "/api/temu/openapi/bind": ["admin", "manager"],
  "/api/temu/openapi/unbind": ["admin", "manager"],
  "/api/temu/openapi/products/sync": ["admin", "manager"],
  "/api/temu/openapi/products": ["admin", "manager", "buyer"],
  "/api/temu/openapi/products/skc": ["admin", "manager", "operations", "buyer", "viewer", "finance"],
  "/api/temu/openapi/sales": ["admin", "manager", "operations", "buyer", "viewer", "finance"],
  "/api/temu/openapi/records": ["admin", "manager", "operations", "buyer", "viewer", "finance"],
  "/purchase": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/purchase/workbench": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/purchase/requests": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/purchase/request-ids": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/purchase/action": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/temu/sales-sync": ["admin", "manager", "operations"],
  "/api/temu/jit-vmi-cloud-sync": ["admin", "manager", "operations"],
  "/api/temu/reviews-cloud-sync": ["admin", "manager", "operations"],
  "/api/temu/images-cloud-sync": ["admin", "manager", "operations"],
  "/api/temu/settlement-income-sync": ["admin", "manager", "operations", "finance"],
  "/api/erp/reports/multi-store": ["admin", "manager", "operations", "finance"],
  "/api/erp/reports/mall-dict": ["admin", "manager", "operations", "finance", "buyer", "warehouse"],
  "/api/erp/reports/set-mall-owner": ["admin", "manager"],
  "/api/erp/op-task/list": ["admin", "manager", "operations", "viewer"],
  "/api/erp/op-task/set": ["admin", "manager", "operations"],
  "/api/erp/reports/sku-sales": ["admin", "manager", "operations", "finance"],
  "/api/erp/reports/warehouse-inventory": ["admin", "manager", "operations", "finance", "warehouse"],
  "/api/erp/reports/risk-list": ["admin", "manager", "operations", "viewer"],
  "/api/erp/reports/activity-list": ["admin", "manager", "operations", "viewer"],
  "/api/erp/reports/shop-health": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/stock-orders": ["admin", "manager", "operations", "warehouse", "viewer"],
  "/api/erp/reports/sales-trend": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/product-panel": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/openapi-qc": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/firstship-today": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/goods-created-today": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/quality-panel": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/reviews": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/qc-flaw-images": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/purchase": ["admin", "manager", "finance", "buyer", "operations", "viewer"],
  "/api/erp/reports/settlement": ["admin", "manager", "operations", "finance"],
  "/api/erp/reports/pipeline-overview": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/product-risk-tags": ["admin", "manager", "operations", "finance", "viewer"],
  "/api/erp/reports/yunqi-search": ["admin", "manager", "operations"],
  "/api/erp/reports/yunqi-stats": ["admin", "manager", "operations"],
  "/api/erp/reports/yunqi-info": ["admin", "manager", "operations"],
  "/api/erp/reports/yunqi-selection-list": ["admin", "manager", "operations"],
  "/api/erp/reports/yunqi-selection-ids": ["admin", "manager", "operations"],
  "/api/erp/reports/yunqi-selection-add": ["admin", "manager", "operations"],
  "/api/erp/reports/yunqi-selection-remove": ["admin", "manager", "operations"],
  "/api/erp/reports/yunqi-selection-update": ["admin", "manager", "operations"],
  "/api/erp/reports/yunqi-sync": ["admin", "manager", "operations"],
  "/api/erp/reports/yunqi-categories": ["admin", "manager", "operations"],
  "/warehouse": ["admin", "manager", "warehouse"],
  "/api/warehouse/workbench": ["admin", "manager", "warehouse"],
  "/api/warehouse/action": ["admin", "manager", "warehouse"],
  "/qc": ["admin", "manager", "operations"],
  "/api/qc/workbench": ["admin", "manager", "operations"],
  "/api/qc/action": ["admin", "manager", "operations"],
  "/outbound": ["admin", "manager", "operations", "warehouse"],
  "/api/outbound/workbench": ["admin", "manager", "operations", "warehouse"],
  "/api/outbound/action": ["admin", "manager", "operations", "warehouse"],
  "/api/inventory/action": ["admin", "manager", "operations", "warehouse"],
  "/api/consign-after-sale/action": ["admin", "manager", "operations", "warehouse"],
  "/api/work-items/list": ["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"],
  "/api/work-items/stats": ["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"],
  "/api/work-items/generate": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/work-items/update-status": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
});

const PR_STATUS_LABELS = Object.freeze({
  draft: "草稿",
  submitted: "运营已提交",
  buyer_processing: "采购处理中",
  sourced: "已找货源",
  waiting_ops_confirm: "待运营确认",
  converted_to_po: "已转采购单",
  rejected: "已驳回",
  cancelled: "已取消",
});

const PO_STATUS_LABELS = Object.freeze({
  draft: "草稿",
  pushed_pending_price: "已推单待改价",
  pending_finance_approval: "待财务审批",
  approved_to_pay: "已批准付款",
  paid: "已付款",
  supplier_processing: "供应商备货",
  shipped: "供应商已发货",
  trade_completed: "交易完成",
  arrived: "货已到仓",
  inbounded: "已入库",
  closed: "已关闭",
  delayed: "已延期",
  exception: "异常",
  cancelled: "已取消",
});

const PAYMENT_STATUS_LABELS = Object.freeze({
  pending: "待审批",
  approved: "已批准",
  paid: "已付款",
  rejected: "已驳回",
  unpaid: "未付款",
  deposit_paid: "已付定金",
  partial_refund: "部分退款",
  deducted: "已扣款",
});

const INBOUND_STATUS_LABELS = Object.freeze({
  pending_arrival: "待到货",
  arrived: "已到仓",
  counted: "已核数",
  inbounded_pending_qc: "已入库",
  quantity_mismatch: "数量异常",
  damaged: "破损异常",
  exception: "异常",
  cancelled: "已取消",
});

const BATCH_QC_STATUS_LABELS = Object.freeze({
  pending: "待 QC",
  passed: "QC 通过",
  passed_with_observation: "观察放行",
  partial_passed: "部分通过",
  failed: "QC 不通过",
  rework_required: "需返工",
});

const QC_STATUS_LABELS = Object.freeze({
  pending_qc: "待抽检",
  in_progress: "抽检中",
  passed: "通过",
  passed_with_observation: "观察通过",
  partial_passed: "部分通过",
  failed: "不通过",
  rework_required: "需返工",
  exception: "异常",
});

const OUTBOUND_STATUS_LABELS = Object.freeze({
  draft: "草稿",
  pending_warehouse: "待仓库处理",
  picking: "拣货中",
  packed: "已打包",
  shipped_out: "已发出",
  pending_ops_confirm: "待运营确认",
  confirmed: "已确认",
  exception: "异常",
  cancelled: "已取消",
});

const USER_STATUS_LABELS = Object.freeze({
  active: "启用",
  blocked: "停用",
});

const USER_ROLE_OPTIONS = Object.freeze([
  ["admin", "管理员"],
  ["manager", "负责人"],
  ["operations", "运营"],
  ["buyer", "采购"],
  ["finance", "财务"],
  ["warehouse", "仓库"],
  ["viewer", "只读"],
]);

const lanState = {
  server: null,
  port: DEFAULT_LAN_PORT,
  bindAddress: DEFAULT_BIND_ADDRESS,
  startedAt: null,
  lastError: null,
  sessions: new Map(),
  sessionStore: null,
  wsClients: new Set(),
};

function roleLabel(role) {
  switch (role) {
    case "admin": return "管理员";
    case "manager": return "负责人";
    case "operations": return "运营";
    case "buyer": return "采购";
    case "finance": return "财务";
    case "warehouse": return "仓库";
    case "viewer": return "只读";
    default: return role || "-";
  }
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(interfaces)) {
    for (const item of entries || []) {
      if (!item || item.family !== "IPv4" || item.internal) continue;
      addresses.push(item.address);
    }
  }
  return addresses;
}

function buildUrls(port, bindAddress = DEFAULT_BIND_ADDRESS) {
  const localUrl = `http://127.0.0.1:${port}`;
  const localOnly = bindAddress === "127.0.0.1" || bindAddress === "localhost";
  const lanAddresses = localOnly ? [] : getLanAddresses();
  const lanUrls = lanAddresses.map((address) => `http://${address}:${port}`);
  if (!localOnly && bindAddress && bindAddress !== DEFAULT_BIND_ADDRESS) {
    const explicitUrl = `http://${bindAddress}:${port}`;
    if (!lanUrls.includes(explicitUrl)) lanUrls.unshift(explicitUrl);
  }
  return {
    localUrl,
    lanUrls,
    primaryUrl: lanUrls[0] || localUrl,
  };
}

function getLanStatus(extra = {}) {
  const urls = buildUrls(lanState.port, lanState.bindAddress);
  return {
    running: Boolean(lanState.server),
    port: lanState.port,
    bindAddress: lanState.bindAddress,
    startedAt: lanState.startedAt,
    localUrl: urls.localUrl,
    primaryUrl: urls.primaryUrl,
    lanUrls: urls.lanUrls,
    routes: [
      { path: "/", label: "入口", allowedRoles: ROLE_PERMISSIONS["/"] },
      { path: "/users", label: "用户管理", allowedRoles: ROLE_PERMISSIONS["/users"] },
      { path: "/1688", label: "1688 授权", allowedRoles: ROLE_PERMISSIONS["/1688"] },
      { path: "/purchase", label: "采购工作台", allowedRoles: ROLE_PERMISSIONS["/purchase"] },
      { path: "/warehouse", label: "仓库工作台", allowedRoles: ROLE_PERMISSIONS["/warehouse"] },
      { path: "/qc", label: "QC 抽检工作台", allowedRoles: ROLE_PERMISSIONS["/qc"] },
      { path: "/outbound", label: "出库发货工作台", allowedRoles: ROLE_PERMISSIONS["/outbound"] },
      { path: "/health", label: "健康检查" },
      { path: "/api/status", label: "服务状态" },
      { path: "/api/1688/message", label: "1688 消息回调" },
    ],
    authMode: "cookie_session",
    sessionCount: lanState.sessions.size,
    wsClientCount: lanState.wsClients.size,
    lastError: lanState.lastError,
    ...extra,
  };
}

// ----------------------------------------------------------------------------
// 送仓托管统一视图（jst_consign_deliveries + cloud.temu_stock_order_snapshot）
// 通过 ATTACH 跨库 union，按 so_id / stock_order_no 关联。
// 缺 cloud 库时退化为 JST-only。
// ----------------------------------------------------------------------------

const DEFAULT_TEMU_CLOUD_DB_PATH = "/opt/temu-cloud/data/temu-cloud.sqlite";

function getTemuCloudDbPath() {
  return process.env.TEMU_CLOUD_DB_PATH || DEFAULT_TEMU_CLOUD_DB_PATH;
}

function attachTemuCloudDbIfPossible(db) {
  if (!db) return false;
  if (db.__cloudAttachState === "attached") return true;
  if (db.__cloudAttachState === "failed") return false;
  const cloudPath = getTemuCloudDbPath();
  try {
    if (!fs.existsSync(cloudPath)) {
      db.__cloudAttachState = "failed";
      return false;
    }
    db.exec(`ATTACH DATABASE '${cloudPath.replace(/'/g, "''")}' AS cloud`);
    db.__cloudAttachState = "attached";
    return true;
  } catch (error) {
    db.__cloudAttachState = "failed";
    db.__cloudAttachError = error?.message || String(error);
    return false;
  }
}

const UNIFIED_CONSIGN_CTE = `
WITH jst_base AS (
  SELECT
    o_id, so_id, shop_name, status, src_status, shop_status_text,
    item_amount, items_qty, order_date, send_date, outer_deliver_no,
    supplier_name, logistics_company, l_id, sku_info, skus, currency,
    receiver_state, receiver_city, receiver_district,
    local_status_override, inventory_deducted
  FROM jst_consign_deliveries
  WHERE company_id = @company_id AND status_internal != 'deleted'
),
jst_ship_agg AS (
  -- 按 o_id 聚合明细的「本地实发数量」之和：local_ship_qty 为 NULL 时回退到备货数量 qty（默认全发）。
  -- 主表「送货数」列即取此值；它驱动确认发货时的本地库存扣减口径。
  SELECT
    o_id,
    SUM(COALESCE(local_ship_qty, qty, 0)) AS local_ship_total
  FROM jst_consign_deliver_items
  WHERE company_id = @company_id AND status_internal != 'deleted'
  GROUP BY o_id
),
cloud_agg AS (
  SELECT
    stock_order_no AS cloud_so,
    MIN(row_key) AS cloud_row_key,
    MIN(mall_id) AS cloud_mall_id,
    MIN(site) AS cloud_site,
    MIN(parent_order_no) AS cloud_parent_order_no,
    MIN(delivery_batch_sn) AS cloud_delivery_batch_sn,
    MIN(product_id) AS cloud_product_id,
    MIN(skc_id) AS cloud_skc_id,
    MIN(sku_id) AS cloud_sku_id,
    MIN(sku_ext_code) AS cloud_sku_ext_code,
    -- temu_status 是 Temu 数字状态码，且按 source_type 混了三套枚举（备货单/发货单/发货台），
    -- 同一数字含义不同。这里按「来源+码」映射成中文（口径=聚水潭同款词），并用 2 位生命周期
    -- rank 前缀让 MAX 选出最新状态，再 SUBSTR 去掉前缀。读取期归一，历史数据零回填。
    -- 映射依据：云端数字 ↔ 聚水潭中文 3.3 万条交叉统计 + raw_json 字段（isCanJoinDeliverPlatform /
    -- applyDeleteStatus / deliverTime+receiveTime）佐证。未知码兜底为「其他」。
    TRIM(SUBSTR(MAX(
      CASE
        WHEN temu_status IS NULL OR temu_status = '' THEN '00'
        WHEN temu_status NOT GLOB '[0-9]*' THEN '06' || temu_status
        WHEN source_type = 'stock_order'  AND temu_status = '8'        THEN '07取消'
        WHEN source_type = 'stock_order'  AND temu_status = '7'        THEN '06已收货'
        WHEN source_type = 'stock_order'  AND temu_status IN ('2','3') THEN '05已发货'
        WHEN source_type = 'stock_order'  AND temu_status = '1'        THEN '03待发货'
        WHEN source_type = 'stock_order'  AND temu_status = '0'        THEN '02已付款待审核'
        WHEN source_type = 'shipping_list' AND temu_status = '6'       THEN '08异常'
        WHEN source_type = 'shipping_list' AND temu_status = '5'       THEN '07取消'
        WHEN source_type = 'shipping_list' AND temu_status = '2'       THEN '06已收货'
        WHEN source_type = 'shipping_list' AND temu_status = '1'       THEN '05已发货'
        WHEN source_type = 'shipping_list' AND temu_status = '0'       THEN '03待发货'
        WHEN source_type = 'shipping_desk' AND temu_status IN ('0','1') THEN '03待发货'
        ELSE '01其他'
      END
    ), 3)) AS cloud_temu_status,
    SUM(COALESCE(demand_qty, 0)) AS cloud_demand_qty,
    SUM(COALESCE(delivered_qty, 0)) AS cloud_delivered_qty,
    SUM(COALESCE(inbound_qty, 0)) AS cloud_inbound_qty,
    SUM(COALESCE(order_amount_cents, 0)) AS cloud_order_amount_cents,
    MIN(currency) AS cloud_currency,
    MIN(product_name) AS cloud_product_name,
    MIN(spec_name) AS cloud_spec_name,
    MIN(delivery_order_sn) AS cloud_delivery_order_sn,
    MIN(receive_warehouse_id) AS cloud_receive_warehouse_id,
    MIN(receive_warehouse_name) AS cloud_receive_warehouse_name,
    MIN(warehouse_group) AS cloud_warehouse_group,
    MIN(urgency_info) AS cloud_urgency_info,
    MIN(order_time) AS cloud_order_time,
    MIN(latest_ship_at) AS cloud_latest_ship_at,
    MIN(logistics_info) AS cloud_logistics_info,
    COUNT(*) AS cloud_item_count
  FROM cloud.temu_stock_order_snapshot
  WHERE stock_order_no IS NOT NULL AND stock_order_no != ''
  GROUP BY stock_order_no
),
jst_left AS (
  SELECT
    j.so_id AS so_id,
    CASE WHEN c.cloud_so IS NULL THEN 'jst' ELSE 'both' END AS source,
    j.o_id AS jst_o_id,
    j.shop_name AS jst_shop_name,
    j.status AS jst_status,
    j.src_status AS jst_src_status,
    j.shop_status_text AS jst_shop_status_text,
    j.item_amount AS jst_item_amount,
    j.items_qty AS jst_items_qty,
    j.order_date AS jst_order_date,
    j.send_date AS jst_send_date,
    j.outer_deliver_no AS jst_outer_deliver_no,
    j.supplier_name AS jst_supplier_name,
    j.logistics_company AS jst_logistics_company,
    j.l_id AS jst_l_id,
    j.sku_info AS jst_sku_info,
    j.skus AS jst_skus,
    j.currency AS jst_currency,
    j.receiver_state AS jst_receiver_state,
    j.receiver_city AS jst_receiver_city,
    j.receiver_district AS jst_receiver_district,
    j.local_status_override AS local_status_override,
    j.inventory_deducted AS inventory_deducted,
    sa.local_ship_total AS jst_local_ship_total,
    c.cloud_so,
    c.cloud_row_key,
    c.cloud_mall_id,
    c.cloud_site,
    c.cloud_parent_order_no,
    c.cloud_delivery_batch_sn,
    c.cloud_product_id,
    c.cloud_skc_id,
    c.cloud_sku_id,
    c.cloud_sku_ext_code,
    c.cloud_temu_status,
    c.cloud_demand_qty,
    c.cloud_delivered_qty,
    c.cloud_inbound_qty,
    c.cloud_order_amount_cents,
    c.cloud_currency,
    c.cloud_product_name,
    c.cloud_spec_name,
    c.cloud_delivery_order_sn,
    c.cloud_receive_warehouse_id,
    c.cloud_receive_warehouse_name,
    c.cloud_warehouse_group,
    c.cloud_urgency_info,
    c.cloud_order_time,
    c.cloud_latest_ship_at,
    c.cloud_logistics_info,
    c.cloud_item_count
  FROM jst_base j
  LEFT JOIN cloud_agg c ON c.cloud_so = j.so_id
  LEFT JOIN jst_ship_agg sa ON sa.o_id = j.o_id
),
cloud_only AS (
  SELECT
    c.cloud_so AS so_id,
    'cloud' AS source,
    NULL AS jst_o_id,
    NULL AS jst_shop_name,
    NULL AS jst_status,
    NULL AS jst_src_status,
    NULL AS jst_shop_status_text,
    NULL AS jst_item_amount,
    NULL AS jst_items_qty,
    NULL AS jst_order_date,
    NULL AS jst_send_date,
    NULL AS jst_outer_deliver_no,
    NULL AS jst_supplier_name,
    NULL AS jst_logistics_company,
    NULL AS jst_l_id,
    NULL AS jst_sku_info,
    NULL AS jst_skus,
    NULL AS jst_currency,
    NULL AS jst_receiver_state,
    NULL AS jst_receiver_city,
    NULL AS jst_receiver_district,
    ls.local_status_override AS local_status_override,
    COALESCE(ls.inventory_deducted, 0) AS inventory_deducted,
    NULL AS jst_local_ship_total,
    c.cloud_so,
    c.cloud_row_key,
    c.cloud_mall_id,
    c.cloud_site,
    c.cloud_parent_order_no,
    c.cloud_delivery_batch_sn,
    c.cloud_product_id,
    c.cloud_skc_id,
    c.cloud_sku_id,
    c.cloud_sku_ext_code,
    c.cloud_temu_status,
    c.cloud_demand_qty,
    c.cloud_delivered_qty,
    c.cloud_inbound_qty,
    c.cloud_order_amount_cents,
    c.cloud_currency,
    c.cloud_product_name,
    c.cloud_spec_name,
    c.cloud_delivery_order_sn,
    c.cloud_receive_warehouse_id,
    c.cloud_receive_warehouse_name,
    c.cloud_warehouse_group,
    c.cloud_urgency_info,
    c.cloud_order_time,
    c.cloud_latest_ship_at,
    c.cloud_logistics_info,
    c.cloud_item_count
  FROM cloud_agg c
  LEFT JOIN erp_consign_local_state ls
    ON ls.mall_id = c.cloud_mall_id AND ls.so_id = c.cloud_so
  WHERE NOT EXISTS (SELECT 1 FROM jst_base j WHERE j.so_id = c.cloud_so)
),
unified AS (
  SELECT * FROM jst_left
  UNION ALL
  SELECT * FROM cloud_only
)
`;

// ===== 出库中心「官方 API 化」开关 =====
// OPENAPI_CONSIGN=1 时,把上面 UNIFIED_CONSIGN_CTE 里的 cloud_agg 段(抓包 temu_stock_order_snapshot)
// 用正则整段替换成读官方物化表 erp_temu_openapi_consign(temuOpenApiConsign.cjs 解析,WB级)。
// 其余段(jst_base/jst_ship_agg/jst_left/cloud_only/unified)完全复用,杜绝 SQL 漂移;匹配不到则安全退回抓包。
// 官方 cloud_agg 已是 WB 级(物化时聚合),不用 GROUP BY;temu_status 已映射中文;order_time 已是日期串(修排序乱)。
const _CLOUD_AGG_OFFICIAL = `cloud_agg AS (
    SELECT
      so_id AS cloud_so,
      so_id AS cloud_row_key,
      c.mall_id AS cloud_mall_id,
      NULL AS cloud_site,
      original_po_sn AS cloud_parent_order_no,
      NULL AS cloud_delivery_batch_sn,
      product_id AS cloud_product_id,
      product_skc_id AS cloud_skc_id,
      NULL AS cloud_sku_id,
      sku_ext_codes AS cloud_sku_ext_code,
      temu_status AS cloud_temu_status,
      demand_qty AS cloud_demand_qty,
      delivered_qty AS cloud_delivered_qty,
      received_qty AS cloud_inbound_qty,
      amount_cents AS cloud_order_amount_cents,
      'CNY' AS cloud_currency,
      product_name AS cloud_product_name,
      spec_names AS cloud_spec_name,
      delivery_order_sn AS cloud_delivery_order_sn,
      NULL AS cloud_receive_warehouse_id,
      receive_warehouse_name AS cloud_receive_warehouse_name,
      NULL AS cloud_warehouse_group,
      NULL AS cloud_urgency_info,
      order_time AS cloud_order_time,
      latest_ship_at AS cloud_latest_ship_at,
      CASE WHEN COALESCE(express_company,'')<>'' OR COALESCE(express_delivery_sn,'')<>''
           THEN TRIM(COALESCE(express_company,'') || ' ' || COALESCE(express_delivery_sn,''))
           ELSE NULL END AS cloud_logistics_info,
      sku_count AS cloud_item_count,
      receive_address_json AS cloud_receive_address_json,
      m.send_address_json AS cloud_send_address_json
    FROM erp_temu_openapi_consign c
    LEFT JOIN erp_temu_malls m ON m.mall_id = c.mall_id
  ),`;
const _CLOUD_AGG_SCRAPE_RE = /cloud_agg AS \([\s\S]*?GROUP BY stock_order_no\s*\n\),/;
function buildUnifiedConsignCte() {
  if (process.env.OPENAPI_CONSIGN !== "1") return UNIFIED_CONSIGN_CTE;
  if (!_CLOUD_AGG_SCRAPE_RE.test(UNIFIED_CONSIGN_CTE)) return UNIFIED_CONSIGN_CTE;
  return UNIFIED_CONSIGN_CTE.replace(_CLOUD_AGG_SCRAPE_RE, _CLOUD_AGG_OFFICIAL);
}

function buildUnifiedSearchClause(values, search) {
  if (!search) return "";
  values.search = `%${search}%`;
  return `(
    so_id LIKE @search
    OR jst_shop_name LIKE @search
    OR jst_outer_deliver_no LIKE @search
    OR jst_supplier_name LIKE @search
    OR jst_sku_info LIKE @search
    OR jst_skus LIKE @search
    OR jst_logistics_company LIKE @search
    OR jst_l_id LIKE @search
    OR cloud_mall_id LIKE @search
    OR cloud_site LIKE @search
    OR cloud_parent_order_no LIKE @search
    OR cloud_delivery_batch_sn LIKE @search
    OR cloud_product_id LIKE @search
    OR cloud_skc_id LIKE @search
    OR cloud_sku_id LIKE @search
    OR cloud_sku_ext_code LIKE @search
    OR cloud_product_name LIKE @search
    OR cloud_spec_name LIKE @search
    OR cloud_delivery_order_sn LIKE @search
  )`;
}

function unifiedRowToPayload(row) {
  if (!row) return null;
  const source = row.source;
  const itemAmount = source === "cloud"
    ? (row.cloud_order_amount_cents != null ? Number(row.cloud_order_amount_cents) / 100 : null)
    : (row.jst_item_amount != null ? Number(row.jst_item_amount) : null);
  const itemsQty = row.jst_items_qty != null
    ? Number(row.jst_items_qty)
    : (row.cloud_demand_qty != null ? Number(row.cloud_demand_qty) : null);
  const rawCloud = (source === "cloud" || source === "both") ? {
    stock_order_no: row.cloud_so,
    row_key: row.cloud_row_key,
    mall_id: row.cloud_mall_id,
    site: row.cloud_site,
    parent_order_no: row.cloud_parent_order_no,
    delivery_batch_sn: row.cloud_delivery_batch_sn,
    product_id: row.cloud_product_id,
    skc_id: row.cloud_skc_id,
    sku_id: row.cloud_sku_id,
    sku_ext_code: row.cloud_sku_ext_code,
    temu_status: row.cloud_temu_status,
    demand_qty: row.cloud_demand_qty,
    delivered_qty: row.cloud_delivered_qty,
    inbound_qty: row.cloud_inbound_qty,
    order_amount_cents: row.cloud_order_amount_cents,
    currency: row.cloud_currency,
    product_name: row.cloud_product_name,
    spec_name: row.cloud_spec_name,
    delivery_order_sn: row.cloud_delivery_order_sn,
    receive_warehouse_id: row.cloud_receive_warehouse_id,
    receive_warehouse_name: row.cloud_receive_warehouse_name,
    warehouse_group: row.cloud_warehouse_group,
    urgency_info: row.cloud_urgency_info,
    order_time: row.cloud_order_time,
    latest_ship_at: row.cloud_latest_ship_at,
    logistics_info: row.cloud_logistics_info,
    item_count: row.cloud_item_count,
    receive_address_json: row.cloud_receive_address_json,
    send_address_json: row.cloud_send_address_json,
  } : null;
  const rawJst = (source === "jst" || source === "both") ? {
    o_id: row.jst_o_id,
    so_id: row.so_id,
    shop_name: row.jst_shop_name,
    status: row.jst_status,
    src_status: row.jst_src_status,
    shop_status_text: row.jst_shop_status_text,
    item_amount: row.jst_item_amount,
    items_qty: row.jst_items_qty,
    order_date: row.jst_order_date,
    send_date: row.jst_send_date,
    outer_deliver_no: row.jst_outer_deliver_no,
    supplier_name: row.jst_supplier_name,
    logistics_company: row.jst_logistics_company,
    l_id: row.jst_l_id,
    sku_info: row.jst_sku_info,
    skus: row.jst_skus,
    currency: row.jst_currency,
    receiver_state: row.jst_receiver_state,
    receiver_city: row.jst_receiver_city,
    receiver_district: row.jst_receiver_district,
  } : null;
  return {
    soId: row.so_id,
    shopName: row.jst_shop_name || row.cloud_mall_id || null,
    // 本地确认发货后 local_status_override 优先展示（已发货）。
    status: row.local_status_override || row.jst_status || row.cloud_temu_status || null,
    itemAmount,
    itemsQty,
    // 送货数 = 明细本地实发数量之和（默认全发=备货数，逐条改后为实发）。仅有聚水潭明细的行有值。
    localShipQty: row.jst_local_ship_total != null ? Number(row.jst_local_ship_total) : null,
    orderDate: row.jst_order_date || row.cloud_order_time || null,
    outerDeliverNo: row.jst_outer_deliver_no || row.cloud_delivery_order_sn || null,
    supplierName: row.jst_supplier_name || null,
    source,
    localStatusOverride: row.local_status_override || null,
    inventoryDeducted: Number(row.inventory_deducted) === 1,
    rawCloud,
    rawJst,
  };
}

// 物化快照读取：runConsignDeliveriesUnified 优先走这条（毫秒级），由
// scripts/rebuild-consign-snapshot.cjs 后台进程预先把昂贵的 UNIFIED_CONSIGN_CTE 结果落到
// temu_consign_unified_snapshot。读不到 / 太旧 / 任何异常 → 返回 null，调用方回退到在线 CTE
// （正确但慢），因此没有快照 = 退化为现状，零回归。
// 陈旧阈值 12h > cron 重建间隔 6h：留一次 cron 失败/跑慢/排队靠后的余量。
// 若阈值==间隔(原 6h)则零余量，某次 cron 没及时跑就会判陈旧→回退在线 CTE(冷态~46s)拖垮全站。
// 送仓状态非秒级敏感，12h 内的数据延迟可接受，远好过偶发 46s 全站连带超时。
const CONSIGN_SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function readConsignDeliveriesUnifiedFromSnapshot(db, opts) {
  const { companyId, page, pageSize, offset, search, statusFilter, shopFilter, skuCodeFilter, dateFrom, dateTo, source } = opts;
  const tableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='temu_consign_unified_snapshot'")
    .get();
  if (!tableExists) return null;
  const meta = db
    .prepare("SELECT MAX(rebuilt_at) AS m, COUNT(*) AS c FROM temu_consign_unified_snapshot WHERE company_id = ?")
    .get(companyId);
  if (!meta || !meta.c) return null;
  if (meta.m && Date.now() - Number(meta.m) > CONSIGN_SNAPSHOT_MAX_AGE_MS) return null;

  // 新快照有 display_status 列(= COALESCE(jst_status, cloud_temu_status))；
  // 部署后旧快照重建前可能还没有该列，回退到 jst_status，避免「no such column」。
  const hasDisplayStatus = db
    .prepare("SELECT 1 FROM pragma_table_info('temu_consign_unified_snapshot') WHERE name = 'display_status'")
    .get();
  const statusCol = hasDisplayStatus ? "display_status" : "jst_status";

  const buildWhere = (includeSource) => {
    const values = { company_id: companyId };
    const cond = ["company_id = @company_id"];
    if (search) { values.search = `%${search}%`; cond.push("search_blob LIKE @search"); }
    if (statusFilter) { values.status_filter = statusFilter; cond.push(`${statusCol} = @status_filter`); }
    // 店铺 / 商品编码：快照无独立列，统一用 search_blob LIKE（其中已含 shop_name + sku 字段）。
    if (shopFilter) { values.shop_like = `%${shopFilter}%`; cond.push("search_blob LIKE @shop_like"); }
    if (skuCodeFilter) { values.sku_like = `%${skuCodeFilter}%`; cond.push("search_blob LIKE @sku_like"); }
    // 下单时间：快照 order_key = COALESCE(jst_order_date, cloud_order_time)，正好用于区间筛。
    if (dateFrom) { values.date_from = dateFrom; cond.push("order_key >= @date_from"); }
    if (dateTo) { values.date_to = dateTo; cond.push("order_key <= @date_to"); }
    if (includeSource && (source === "cloud" || source === "jst" || source === "both")) {
      values.source_filter = source;
      cond.push("source = @source_filter");
    }
    return { where: `WHERE ${cond.join(" AND ")}`, values };
  };

  const rowsQ = buildWhere(true);
  const rows = db.prepare(`
    SELECT payload_json FROM temu_consign_unified_snapshot
    ${rowsQ.where}
    ORDER BY order_key DESC, so_id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...rowsQ.values, limit: pageSize, offset });

  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM temu_consign_unified_snapshot ${rowsQ.where}`).get(rowsQ.values);

  // breakdown 与在线一致：不含 source 过滤
  const bdQ = buildWhere(false);
  const bdRows = db.prepare(`
    SELECT source, COUNT(*) AS n FROM temu_consign_unified_snapshot ${bdQ.where} GROUP BY source
  `).all(bdQ.values);
  const sourceBreakdown = { cloud_only: 0, jst_only: 0, both: 0 };
  for (const r of bdRows) {
    if (r.source === "cloud") sourceBreakdown.cloud_only = Number(r.n || 0);
    else if (r.source === "jst") sourceBreakdown.jst_only = Number(r.n || 0);
    else if (r.source === "both") sourceBreakdown.both = Number(r.n || 0);
  }

  // 状态分布：只受搜索约束，按显示状态(display_status，回退 jst_status)分组，与筛选口径一致。
  const sbValues = { company_id: companyId };
  const sbCond = ["company_id = @company_id"];
  if (search) { sbValues.search = `%${search}%`; sbCond.push("search_blob LIKE @search"); }
  const statusBreakdown = {};
  for (const r of db.prepare(`
    SELECT ${statusCol} AS status, COUNT(*) AS n FROM temu_consign_unified_snapshot
    WHERE ${sbCond.join(" AND ")} GROUP BY ${statusCol}
  `).all(sbValues)) {
    const key = r.status == null || r.status === "" ? "(空)" : String(r.status);
    statusBreakdown[key] = Number(r.n || 0);
  }

  return {
    ok: true,
    rows: rows.map((r) => JSON.parse(r.payload_json)),
    total: Number(totalRow?.n || 0),
    page,
    pageSize,
    sourceBreakdown,
    statusBreakdown,
    fromSnapshot: true,
  };
}

function runConsignDeliveriesUnified(db, params = {}) {
  if (!db) {
    return {
      ok: true,
      rows: [],
      total: 0,
      page: 1,
      pageSize: Number(params.pageSize || 100),
      sourceBreakdown: { cloud_only: 0, jst_only: 0, both: 0 },
      statusBreakdown: {},
    };
  }
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.max(1, Math.min(500, Number(params.pageSize || 100)));
  const offset = (page - 1) * pageSize;
  const search = String(params.search || "").trim();
  const statusFilter = String(params.status || "").trim();
  const shopFilter = String(params.shop || "").trim();
  const skuCodeFilter = String(params.skuCode || params.sku_code || "").trim();
  const dateFrom = String(params.dateFrom || params.date_from || "").trim();
  const dateTo = String(params.dateTo || params.date_to || "").trim();
  const source = String(params.source || "all").toLowerCase();
  const companyId = params.companyId || params.company_id || "company_default";

  // 优先读物化快照（毫秒级）；读不到/太旧/异常则回退到下方在线 CTE（正确但慢）。
  try {
    const snapshot = readConsignDeliveriesUnifiedFromSnapshot(db, {
      companyId, page, pageSize, offset, search, statusFilter, shopFilter, skuCodeFilter, dateFrom, dateTo, source,
    });
    if (snapshot) return snapshot;
  } catch (snapErr) {
    // 快照读异常不致命，继续走在线 CTE
    void snapErr;
  }

  const cloudAttached = attachTemuCloudDbIfPossible(db);

  if (!cloudAttached) {
    return runConsignDeliveriesUnifiedJstOnly(db, {
      page, pageSize, offset, search, statusFilter, shopFilter, skuCodeFilter, dateFrom, dateTo, source, companyId,
    });
  }

  const baseValues = { company_id: companyId };
  const filterConditions = [];
  const searchClause = buildUnifiedSearchClause(baseValues, search);
  if (searchClause) filterConditions.push(searchClause);
  if (statusFilter) {
    baseValues.status_filter = statusFilter;
    // 状态用「显示状态」= COALESCE(local_status_override, jst_status, cloud_temu_status)：
    // 本地确认发货后优先按覆盖状态（已发货）筛；否则聚水潭(jst)内部状态；cloud-only 兜底用 Temu 状态。
    filterConditions.push("COALESCE(local_status_override, jst_status, cloud_temu_status) = @status_filter");
  }
  if (shopFilter) {
    baseValues.shop_like = `%${shopFilter}%`;
    filterConditions.push("COALESCE(jst_shop_name, cloud_mall_id) LIKE @shop_like");
  }
  if (skuCodeFilter) {
    baseValues.sku_like = `%${skuCodeFilter}%`;
    filterConditions.push("(jst_skus LIKE @sku_like OR jst_sku_info LIKE @sku_like OR cloud_sku_ext_code LIKE @sku_like OR cloud_sku_id LIKE @sku_like)");
  }
  if (dateFrom) {
    baseValues.date_from = dateFrom;
    filterConditions.push("COALESCE(jst_order_date, cloud_order_time) >= @date_from");
  }
  if (dateTo) {
    baseValues.date_to = dateTo;
    filterConditions.push("COALESCE(jst_order_date, cloud_order_time) <= @date_to");
  }

  let sourceCondition = "";
  if (source === "cloud") sourceCondition = "source = 'cloud'";
  else if (source === "jst") sourceCondition = "source = 'jst'";
  else if (source === "both") sourceCondition = "source = 'both'";

  const filtered = [...filterConditions];
  if (sourceCondition) filtered.push(sourceCondition);
  const whereClause = filtered.length ? `WHERE ${filtered.join(" AND ")}` : "";
  const breakdownWhere = filterConditions.length ? `WHERE ${filterConditions.join(" AND ")}` : "";

  const rowsSql = `${buildUnifiedConsignCte()}
    SELECT * FROM unified
    ${whereClause}
    ORDER BY COALESCE(jst_order_date, cloud_order_time) DESC, so_id DESC
    LIMIT @limit OFFSET @offset`;
  const rows = db.prepare(rowsSql).all({ ...baseValues, limit: pageSize, offset });

  const totalSql = `${buildUnifiedConsignCte()} SELECT COUNT(*) AS n FROM unified ${whereClause}`;
  const totalRow = db.prepare(totalSql).get(baseValues);
  const total = Number(totalRow?.n || 0);

  const breakdownSql = `${buildUnifiedConsignCte()}
    SELECT source, COUNT(*) AS n FROM unified ${breakdownWhere} GROUP BY source`;
  const breakdownRows = db.prepare(breakdownSql).all(baseValues);
  const sourceBreakdown = { cloud_only: 0, jst_only: 0, both: 0 };
  for (const r of breakdownRows) {
    if (r.source === "cloud") sourceBreakdown.cloud_only = Number(r.n || 0);
    else if (r.source === "jst") sourceBreakdown.jst_only = Number(r.n || 0);
    else if (r.source === "both") sourceBreakdown.both = Number(r.n || 0);
  }

  // 状态分布：基于显示状态(COALESCE(local_status_override, jst_status, cloud_temu_status))，
  // 只受搜索约束，与筛选口径一致，保证下拉始终能列出全部真实可筛状态值。
  const statusBreakdownWhere = searchClause ? `WHERE ${searchClause}` : "";
  const statusBreakdownSql = `${buildUnifiedConsignCte()}
    SELECT COALESCE(local_status_override, jst_status, cloud_temu_status) AS status, COUNT(*) AS n
    FROM unified ${statusBreakdownWhere}
    GROUP BY COALESCE(local_status_override, jst_status, cloud_temu_status)`;
  const statusBreakdown = {};
  for (const r of db.prepare(statusBreakdownSql).all(baseValues)) {
    const key = r.status == null || r.status === "" ? "(空)" : String(r.status);
    statusBreakdown[key] = Number(r.n || 0);
  }

  return {
    ok: true,
    rows: rows.map(unifiedRowToPayload),
    total,
    page,
    pageSize,
    sourceBreakdown,
    statusBreakdown,
  };
}

function runConsignDeliveriesUnifiedJstOnly(db, opts) {
  const { page, pageSize, offset, search, statusFilter, shopFilter, skuCodeFilter, dateFrom, dateTo, source, companyId } = opts;
  if (source === "cloud" || source === "both") {
    return {
      ok: true,
      rows: [],
      total: 0,
      page, pageSize,
      sourceBreakdown: { cloud_only: 0, jst_only: 0, both: 0 },
      statusBreakdown: {},
    };
  }
  const conditions = ["company_id = @company_id", "status_internal != 'deleted'"];
  const values = { company_id: companyId };
  if (search) {
    values.search = `%${search}%`;
    conditions.push(`(so_id LIKE @search OR shop_name LIKE @search OR outer_deliver_no LIKE @search OR supplier_name LIKE @search OR sku_info LIKE @search OR skus LIKE @search OR logistics_company LIKE @search OR l_id LIKE @search)`);
  }
  if (statusFilter) {
    values.status_filter = statusFilter;
    conditions.push("COALESCE(local_status_override, status) = @status_filter");
  }
  if (shopFilter) {
    values.shop_like = `%${shopFilter}%`;
    conditions.push("shop_name LIKE @shop_like");
  }
  if (skuCodeFilter) {
    values.sku_like = `%${skuCodeFilter}%`;
    conditions.push("(skus LIKE @sku_like OR sku_info LIKE @sku_like)");
  }
  if (dateFrom) {
    values.date_from = dateFrom;
    conditions.push("order_date >= @date_from");
  }
  if (dateTo) {
    values.date_to = dateTo;
    conditions.push("order_date <= @date_to");
  }
  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const rows = db.prepare(`
    SELECT * FROM jst_consign_deliveries
    ${whereClause}
    ORDER BY order_date DESC, o_id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...values, limit: pageSize, offset });
  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM jst_consign_deliveries ${whereClause}`).get(values);
  const total = Number(totalRow?.n || 0);

  // 状态分布：只受搜索约束，不受状态过滤约束，保证下拉列出全部真实状态值。
  const statusBdConditions = ["company_id = @company_id", "status_internal != 'deleted'"];
  if (search) {
    statusBdConditions.push(`(so_id LIKE @search OR shop_name LIKE @search OR outer_deliver_no LIKE @search OR supplier_name LIKE @search OR sku_info LIKE @search OR skus LIKE @search OR logistics_company LIKE @search OR l_id LIKE @search)`);
  }
  const statusBreakdown = {};
  for (const r of db.prepare(`
    SELECT COALESCE(local_status_override, status) AS status, COUNT(*) AS n FROM jst_consign_deliveries
    WHERE ${statusBdConditions.join(" AND ")}
    GROUP BY COALESCE(local_status_override, status)
  `).all(values)) {
    const key = r.status == null || r.status === "" ? "(空)" : String(r.status);
    statusBreakdown[key] = Number(r.n || 0);
  }

  return {
    ok: true,
    rows: rows.map((row) => ({
      soId: row.so_id,
      shopName: row.shop_name || null,
      status: row.local_status_override || row.status || null,
      localStatusOverride: row.local_status_override || null,
      inventoryDeducted: Number(row.inventory_deducted) === 1,
      itemAmount: row.item_amount != null ? Number(row.item_amount) : null,
      itemsQty: row.items_qty != null ? Number(row.items_qty) : null,
      orderDate: row.order_date || null,
      outerDeliverNo: row.outer_deliver_no || null,
      supplierName: row.supplier_name || null,
      source: "jst",
      rawCloud: null,
      rawJst: {
        o_id: row.o_id,
        so_id: row.so_id,
        shop_name: row.shop_name,
        status: row.status,
        src_status: row.src_status,
        shop_status_text: row.shop_status_text,
        item_amount: row.item_amount,
        items_qty: row.items_qty,
        order_date: row.order_date,
        send_date: row.send_date,
        outer_deliver_no: row.outer_deliver_no,
        supplier_name: row.supplier_name,
        logistics_company: row.logistics_company,
        l_id: row.l_id,
        sku_info: row.sku_info,
        skus: row.skus,
        currency: row.currency,
      },
    })),
    total,
    page,
    pageSize,
    sourceBreakdown: { cloud_only: 0, jst_only: total, both: 0 },
    statusBreakdown,
  };
}

// ===== 店铺数据隔离（阶段三）响应裁剪器 =====
// 递归遍历响应体：凡是「带店铺标识(mall_id 等)的对象」组成的数组，丢掉不属于当前用户负责店铺的元素。
// copy-on-change：未变化的分支返回原引用，既避免深拷贝大响应，又避免污染上游缓存对象
// （multiStoreReport 等 build 函数会缓存并复用返回值，直接 mutate 会让特权用户也拿到被裁数据）。
const STORE_SCOPE_ID_KEYS = ["mall_id", "mallId", "mall_supplier_id", "mallSupplierId"];
const STORE_SCOPE_CODE_KEYS = ["store_code", "storeCode"];
// 计数型汇总字段名特征（店铺数/在线数/条数等）。裁剪数组后，同对象里等于「被裁数组原长度」的计数字段同步重算。
// 只匹配计数语义的键名，避免误伤金额字段（金额合计前端基于裁剪后列表 reduce，自动正确，无需后端重算）。
const STORE_SCOPE_COUNT_KEY_RE = /count|num/i;

function storeScopeItemMallId(item) {
  for (const k of STORE_SCOPE_ID_KEYS) {
    const v = item[k];
    if (v != null && v !== "") return String(v);
  }
  return null;
}

function storeScopeItemHasStoreKey(item) {
  for (const k of STORE_SCOPE_ID_KEYS) if (item[k] != null && item[k] !== "") return true;
  for (const k of STORE_SCOPE_CODE_KEYS) if (item[k] != null && item[k] !== "") return true;
  return false;
}

function storeScopeItemAllowed(item, scope) {
  const mid = storeScopeItemMallId(item);
  if (mid != null) return scope.mallIds.has(mid);
  for (const k of STORE_SCOPE_CODE_KEYS) {
    const v = item[k];
    if (v != null && v !== "") return scope.storeCodes.has(String(v));
  }
  return true; // 没有店铺标识的元素不裁
}

function pruneStoreScope(value, scope, depth = 0) {
  if (depth > 12 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let changed = false;
    const kept = [];
    for (const el of value) {
      if (el && typeof el === "object" && !Array.isArray(el)
        && storeScopeItemHasStoreKey(el) && !storeScopeItemAllowed(el, scope)) {
        changed = true; // 不属于负责店铺，丢弃
        continue;
      }
      const pruned = pruneStoreScope(el, scope, depth + 1);
      if (pruned !== el) changed = true;
      kept.push(pruned);
    }
    return changed ? kept : value;
  }
  let changed = false;
  const out = {};
  const prunedArrays = []; // 记录被裁短的数组：{ oldLen, newLen }，供同级计数字段同步重算
  for (const k of Object.keys(value)) {
    const v = value[k];
    const pruned = pruneStoreScope(v, scope, depth + 1);
    out[k] = pruned;
    if (pruned !== v) {
      changed = true;
      if (Array.isArray(v) && Array.isArray(pruned) && pruned.length < v.length) {
        prunedArrays.push({ oldLen: v.length, newLen: pruned.length });
      }
    }
  }
  // 汇总兜底：同一对象内「计数型标量字段」若其值恰等于某个被裁数组的原长度，同步改为裁剪后长度。
  // 双约束(键名像计数 + 值==被裁数组原长度)使误伤金额字段概率极低；金额合计前端基于裁剪后列表 reduce 自动正确。
  if (prunedArrays.length) {
    for (const k of Object.keys(out)) {
      if (typeof out[k] === "number" && STORE_SCOPE_COUNT_KEY_RE.test(k)) {
        const hit = prunedArrays.find((d) => d.oldLen === out[k]);
        if (hit) { out[k] = hit.newLen; changed = true; }
      }
    }
  }
  return changed ? out : value;
}

function writeJson(res, statusCode, payload, headers = {}) {
  // 店铺数据隔离：handleRequest 鉴权后给非特权用户的请求挂了 res._storeScope，这里统一裁剪。
  if (res && res._storeScope && payload && typeof payload === "object" && payload.ok !== false) {
    try {
      payload = pruneStoreScope(payload, res._storeScope);
    } catch {
      // 裁剪失败回退原 payload，不阻断响应。
    }
  }
  const body = JSON.stringify(payload, null, 2);
  let buf = Buffer.from(body);
  const respHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Id",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  };
  // 0.3.25 跨海带宽优化：对 >=4KB 的 JSON 响应按 Accept-Encoding 协商 gzip。
  // 采购/商品 workbench 经常 1-4MB，gzip 后通常压到 1/5 - 1/10，跨海下载尤其受益。
  // <4KB 走 raw，避免 gzip 头部反而变大；客户端 Electron / Node http 默认带 gzip 自动解压。
  const acceptEnc = String(res.req?.headers?.["accept-encoding"] || "").toLowerCase();
  if (buf.length >= 4096 && acceptEnc.includes("gzip")) {
    try {
      buf = zlib.gzipSync(buf);
      respHeaders["Content-Encoding"] = "gzip";
      respHeaders["Vary"] = "Accept-Encoding";
    } catch {
      // 压缩失败回退 raw body
    }
  }
  respHeaders["Content-Length"] = buf.length;
  res.writeHead(statusCode, respHeaders);
  res.end(buf);
}

// 与 writeJson 同款响应头，但入参已是序列化好的 JSON 字符串（worker 出串、主线程拼接得到），
// 且用「异步 gzip」(libuv 线程池) 代替 gzipSync —— 压缩 ~18MB 不再阻塞主线程事件循环
// （实测同步 gzip 18MB ≈ 170ms，是透传后主线程剩余的最大单项开销）。
// 仅用于已确认无需 store-scope 出口裁剪的透传快路（裁剪需对象，见 /api/purchase/workbench）。
function writeRawJsonGzip(res, statusCode, jsonStr, headers = {}) {
  const respHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Id",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  };
  const buf = Buffer.from(jsonStr);
  const acceptEnc = String(res.req?.headers?.["accept-encoding"] || "").toLowerCase();
  if (buf.length >= 4096 && acceptEnc.includes("gzip")) {
    zlib.gzip(buf, (err, gz) => {
      if (err) {
        respHeaders["Content-Length"] = buf.length;
        res.writeHead(statusCode, respHeaders);
        res.end(buf);
        return;
      }
      respHeaders["Content-Encoding"] = "gzip";
      respHeaders["Vary"] = "Accept-Encoding";
      respHeaders["Content-Length"] = gz.length;
      res.writeHead(statusCode, respHeaders);
      res.end(gz);
    });
  } else {
    respHeaders["Content-Length"] = buf.length;
    res.writeHead(statusCode, respHeaders);
    res.end(buf);
  }
}

function writeText(res, statusCode, body, headers = {}) {
  const text = String(body ?? "");
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(text);
}

function uploadRootDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const userDataDir = process.env.APP_USER_DATA || process.env.TEMU_USER_DATA || path.join(appData, "temu-automation");
  const dataDir = process.env.ERP_DATA_DIR || process.env.ERP_DATA_PATH || path.join(userDataDir, "data");
  return path.join(dataDir, "uploads");
}

function updateReleaseRootDir() {
  const explicit = process.env.TEMU_UPDATE_RELEASES_DIR || process.env.ERP_UPDATE_RELEASES_DIR;
  if (explicit) return path.resolve(explicit);
  if (process.platform !== "win32") return "/opt/temu-updates/releases";

  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const userDataDir = process.env.APP_USER_DATA || process.env.TEMU_USER_DATA || path.join(appData, "temu-automation");
  const dataDir = process.env.ERP_DATA_DIR || process.env.ERP_DATA_PATH || path.join(userDataDir, "data");
  return path.join(dataDir, "releases");
}

function imageContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function updateReleaseContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".yml" || ext === ".yaml") return "text/yaml; charset=utf-8";
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
}

function updateReleaseCacheControl(filePath) {
  return path.basename(filePath).toLowerCase() === "latest.yml"
    ? "no-cache, no-store, must-revalidate"
    : "public, max-age=31536000, immutable";
}

function parseHttpRange(rangeHeader, size) {
  const match = String(rangeHeader || "").match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  let start = match[1] === "" ? null : Number(match[1]);
  let end = match[2] === "" ? null : Number(match[2]);

  if (start === null && end === null) return null;
  if (start === null) {
    const suffixLength = end;
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    if (!Number.isFinite(start) || start < 0) return null;
    if (end === null || end >= size) end = size - 1;
  }
  if (!Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

function resolveUpdateReleasePath(pathname) {
  const root = updateReleaseRootDir();
  const relativePath = decodeURIComponent(pathname.replace(/^\/releases\/?/, ""));
  if (!relativePath || relativePath.includes("\0")) return { root, target: null };
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    return { root, target: null, forbidden: true };
  }
  return { root, target };
}

function renderUpdateReleaseIndex() {
  const root = updateReleaseRootDir();
  const latestPath = path.join(root, "latest.yml");
  let installerName = "";
  let version = "";
  try {
    const latest = fs.readFileSync(latestPath, "utf8");
    version = latest.match(/^version:\s*(.+)$/m)?.[1]?.trim() || "";
    installerName = latest.match(/^path:\s*(.+)$/m)?.[1]?.trim() || "";
  } catch {}

  const installerLink = installerName
    ? `<a href="/releases/${encodeURIComponent(installerName)}">${escapeHtml(installerName)}</a>`
    : "No installer has been published yet.";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Temu 更新源</title>
  <style>
    body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; margin: 40px; color: #1f2329; }
    code, a { word-break: break-all; }
    .box { max-width: 760px; border: 1px solid #e5e7eb; border-radius: 10px; padding: 24px; }
    .muted { color: #6b7280; }
  </style>
</head>
<body>
  <main class="box">
    <h1>Temu 桌面端更新源</h1>
    <p class="muted">客户端更新源地址：<code>https://erp.temu.chat/releases/</code></p>
    <p>当前版本：<strong>${escapeHtml(version || "-")}</strong></p>
    <p>安装包：${installerLink}</p>
    <p><a href="/releases/latest.yml">latest.yml</a></p>
  </main>
</body>
</html>`;
}

function serveUpdateReleaseFile(req, res, pathname) {
  if (pathname === "/releases" || pathname === "/releases/") {
    writeHtml(res, renderUpdateReleaseIndex());
    return;
  }

  const { target, forbidden } = resolveUpdateReleasePath(pathname);
  if (forbidden) {
    writeText(res, 403, "Forbidden");
    return;
  }
  if (!target) {
    writeText(res, 404, "Not found");
    return;
  }

  fs.stat(target, (statError, stat) => {
    if (statError || !stat.isFile()) {
      writeText(res, 404, "Not found");
      return;
    }

    const baseHeaders = {
      "Content-Type": updateReleaseContentType(target),
      "Accept-Ranges": "bytes",
      "Cache-Control": updateReleaseCacheControl(target),
      "X-Content-Type-Options": "nosniff",
    };
    const range = parseHttpRange(req.headers.range, stat.size);
    if (req.headers.range && !range) {
      res.writeHead(416, {
        ...baseHeaders,
        "Content-Range": `bytes */${stat.size}`,
      });
      res.end();
      return;
    }

    if (range) {
      res.writeHead(206, {
        ...baseHeaders,
        "Content-Length": range.end - range.start + 1,
        "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      fs.createReadStream(target, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      ...baseHeaders,
      "Content-Length": stat.size,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(target).pipe(res);
  });
}

function serveUploadedFile(_req, res, pathname) {
  const root = uploadRootDir();
  const relativePath = decodeURIComponent(pathname.replace(/^\/uploads\/?/, ""));
  const target = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
    writeText(res, 403, "Forbidden");
    return;
  }
  fs.stat(target, (statError, stat) => {
    if (statError || !stat.isFile()) {
      writeText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": imageContentType(target),
      "Content-Length": stat.size,
      "Cache-Control": "public, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(target).pipe(res);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of lanState.sessions.entries()) {
    if (!session || session.expiresAt <= now) {
      lanState.sessions.delete(token);
    }
  }
  try {
    lanState.sessionStore?.cleanupExpired?.(now);
  } catch {}
}

function createSession(user) {
  cleanupExpiredSessions();
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const session = {
    token,
    user,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  lanState.sessions.set(token, session);
  try {
    lanState.sessionStore?.save?.(token, session);
  } catch {}
  return token;
}

function getSessionFromRequest(req) {
  cleanupExpiredSessions();
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token) return null;
  let session = lanState.sessions.get(token);
  if (!session) {
    try {
      session = lanState.sessionStore?.load?.(token) || null;
    } catch {
      session = null;
    }
    if (session) lanState.sessions.set(token, session);
  }
  if (!session) return null;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  try {
    lanState.sessionStore?.touch?.(token, session);
  } catch {}
  return session;
}

function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token) return;
  lanState.sessions.delete(token);
  try {
    lanState.sessionStore?.destroy?.(token);
  } catch {}
}

function syncLanUserSessions(user = {}) {
  const userId = String(user.id || "").trim();
  if (!userId) return { updated: 0, removed: 0 };
  const nextUser = {
    id: userId,
    name: user.name,
    role: user.role,
    status: user.status,
    companyId: user.companyId,
    companyName: user.companyName,
    companyCode: user.companyCode,
  };
  const isActive = user.status === "active";
  let updated = 0;
  let removed = 0;

  for (const [token, session] of Array.from(lanState.sessions.entries())) {
    if (session?.user?.id !== userId) continue;
    if (!isActive) {
      lanState.sessions.delete(token);
      removed += 1;
      continue;
    }
    session.user = nextUser;
    updated += 1;
  }

  try {
    lanState.sessionStore?.syncUser?.(nextUser);
  } catch {}

  for (const client of Array.from(lanState.wsClients)) {
    if (client?.user?.id !== userId) continue;
    if (!isActive) {
      setTimeout(() => {
        try { client.socket.destroy(); } catch {}
      }, 1200);
      lanState.wsClients.delete(client);
      continue;
    }
    client.user = nextUser;
  }

  return { updated, removed };
}

function writeUpgradeError(socket, statusCode, message) {
  try {
    socket.write([
      `HTTP/1.1 ${statusCode} ${message}`,
      "Connection: close",
      "Content-Length: 0",
      "",
      "",
    ].join("\r\n"));
  } catch {}
  socket.destroy();
}

function encodeWebSocketFrame(payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const length = body.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), body]);
  }
  if (length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, body]);
}

function sendWebSocketPayload(client, payload) {
  if (!client?.socket || client.socket.destroyed) return false;
  try {
    client.socket.write(encodeWebSocketFrame(JSON.stringify(payload)));
    return true;
  } catch {
    try { client.socket.destroy(); } catch {}
    return false;
  }
}

function broadcastLanEvent(payload = {}) {
  const event = {
    type: payload.type || "erp:update",
    at: payload.at || new Date().toISOString(),
    ...payload,
  };
  for (const client of Array.from(lanState.wsClients)) {
    if (!sendWebSocketPayload(client, event)) {
      lanState.wsClients.delete(client);
    }
  }
  return {
    delivered: lanState.wsClients.size,
    event,
  };
}

function handleWebSocketData(client, chunk) {
  if (!chunk || chunk.length < 2) return;
  const opcode = chunk[0] & 0x0f;
  if (opcode === 0x8) {
    lanState.wsClients.delete(client);
    client.socket.end(encodeWebSocketFrame("", 0x8));
    return;
  }
  if (opcode === 0x9) {
    client.socket.write(encodeWebSocketFrame("", 0xA));
  }
}

function handleWebSocketUpgrade(req, socket) {
  let pathname = "/";
  try {
    const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    pathname = parsed.pathname;
  } catch {}

  if (pathname !== "/ws") {
    writeUpgradeError(socket, 404, "Not Found");
    return;
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    writeUpgradeError(socket, 401, "Unauthorized");
    return;
  }

  const key = String(req.headers["sec-websocket-key"] || "").trim();
  const version = String(req.headers["sec-websocket-version"] || "");
  if (!key || version !== "13") {
    writeUpgradeError(socket, 400, "Bad Request");
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n"));
  socket.setNoDelay(true);

  const client = {
    id: crypto.randomBytes(8).toString("hex"),
    user: session.user,
    socket,
    connectedAt: new Date().toISOString(),
  };
  lanState.wsClients.add(client);
  sendWebSocketPayload(client, {
    type: "connected",
    at: new Date().toISOString(),
    userRole: session.user?.role || null,
  });

  socket.on("data", (chunk) => handleWebSocketData(client, chunk));
  socket.on("close", () => lanState.wsClients.delete(client));
  socket.on("error", () => lanState.wsClients.delete(client));
}

function buildSessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function isRoleAllowed(pathname, role) {
  const allowedRoles = ROLE_PERMISSIONS[pathname];
  if (!allowedRoles) return true;
  return allowedRoles.includes(role);
}

// 登录失败限流：同一 IP 连续失败 LOGIN_MAX_FAILS 次后锁定 LOGIN_LOCK_MS，防访问码爆破
const LOGIN_FAILS = new Map();
const LOGIN_MAX_FAILS = 8;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
function loginClientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.socket?.remoteAddress || "unknown";
}
function loginLockRemainingMs(req) {
  const e = LOGIN_FAILS.get(loginClientIp(req));
  if (!e || !e.lockedUntil) return 0;
  const remain = e.lockedUntil - Date.now();
  if (remain <= 0) { LOGIN_FAILS.delete(loginClientIp(req)); return 0; }
  return remain;
}
function recordLoginFail(req) {
  const ip = loginClientIp(req);
  const e = LOGIN_FAILS.get(ip) || { fails: 0, lockedUntil: 0 };
  e.fails += 1;
  if (e.fails >= LOGIN_MAX_FAILS) e.lockedUntil = Date.now() + LOGIN_LOCK_MS;
  LOGIN_FAILS.set(ip, e);
}
function clearLoginFail(req) {
  LOGIN_FAILS.delete(loginClientIp(req));
}

function normalizeLocalNext(value) {
  const text = String(value || "/").trim();
  if (!text.startsWith("/") || text.startsWith("//")) return "/";
  return text;
}

function writeRedirect(res, location, headers = {}) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end();
}

function writeForbidden(res, user, pathname) {
  writeHtml(res, renderShell({
    title: "无权访问",
    subtitle: `${user?.name || "当前用户"}（${roleLabel(user?.role)}）没有访问 ${pathname} 的权限。`,
    cards: [
      {
        title: "可用入口",
        body: "请返回首页，或使用具备对应角色的账号重新登录。",
      },
      {
        title: "当前角色",
        body: `<code>${escapeHtml(roleLabel(user?.role))}</code>`,
      },
    ],
    currentPath: pathname,
    user,
  }), 403);
}

function renderShell({ title, subtitle, cards = [], currentPath, user, content = "" }) {
  const navItems = [
    ["/", "入口"],
    ["/users", "用户"],
    ["/1688", "1688"],
    ["/purchase", "采购"],
    ["/warehouse", "仓库"],
    ["/qc", "QC"],
    ["/outbound", "发货"],
    ["/health", "Health"],
  ];
  const cardHtml = cards.map((card) => `
    <section class="card">
      <div class="card-title">${escapeHtml(card.title)}</div>
      <div class="card-body">${card.body}</div>
    </section>
  `).join("");
  const navHtml = navItems.filter(([path]) => {
    if (path === "/health") return true;
    return !user || isRoleAllowed(path, user.role);
  }).map(([path, label]) => `
    <a class="${path === currentPath ? "active" : ""}" href="${path}">${escapeHtml(label)}</a>
  `).join("");
  const userHtml = user
    ? `<div class="user-pill">${escapeHtml(user.name)} · ${escapeHtml(roleLabel(user.role))}<a href="/logout">退出</a></div>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7fb;
      --panel: #ffffff;
      --line: #e6e8ef;
      --text: #1f2937;
      --muted: #667085;
      --brand: #007aff;
      --blue: #1677ff;
      --green: #16a34a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      padding: 16px 20px;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .top {
      max-width: 1120px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
    }
    .user-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #344054;
      background: #f7f8fb;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 13px;
      white-space: nowrap;
    }
    .user-pill a {
      color: var(--brand);
      text-decoration: none;
      font-weight: 700;
    }
    .dot {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: var(--green);
      box-shadow: 0 0 0 5px rgba(22, 163, 74, 0.12);
    }
    nav {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    nav a {
      color: var(--muted);
      text-decoration: none;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 7px 10px;
      background: #fff;
      font-size: 14px;
    }
    nav a.active {
      color: #fff;
      border-color: var(--brand);
      background: var(--brand);
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 24px 20px 48px;
    }
    .hero {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
      flex-wrap: wrap;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.25;
    }
    .subtitle {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
      max-width: 720px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      border-radius: 999px;
      padding: 4px 11px;
      background: #eef6ff;
      color: var(--blue);
      border: 1px solid #cfe5ff;
      font-size: 13px;
      font-weight: 600;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-height: 132px;
    }
    .card-title {
      font-size: 16px;
      font-weight: 750;
      margin-bottom: 10px;
    }
    .card-body {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
    }
    .section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      margin-top: 16px;
      overflow: hidden;
    }
    .section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      flex-wrap: wrap;
    }
    .section-title {
      font-size: 17px;
      font-weight: 800;
      margin-bottom: 4px;
    }
    .section-subtitle {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 820px;
      font-size: 13px;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid #eef0f5;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #475467;
      background: #fafbfc;
      font-weight: 750;
      white-space: nowrap;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .primary-text {
      color: #1f2937;
      font-weight: 750;
    }
    .muted {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 2px 9px;
      background: #f1f3f7;
      color: #475467;
      border: 1px solid #e4e7ec;
      font-size: 12px;
      font-weight: 750;
      white-space: nowrap;
    }
    .status-warn {
      background: #fff7ed;
      color: #c2410c;
      border-color: #fed7aa;
    }
    .status-info {
      background: #eef6ff;
      color: #175cd3;
      border-color: #cfe5ff;
    }
    .status-ok {
      background: #ecfdf3;
      color: #067647;
      border-color: #abefc6;
    }
    .status-danger {
      background: #fff1f0;
      color: #b42318;
      border-color: #ffd5d5;
    }
    .action-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      border: 0;
      border-radius: 7px;
      padding: 4px 10px;
      background: #007aff;
      color: #fff;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
      cursor: pointer;
      font-family: inherit;
      text-decoration: none;
    }
    .action-chip.secondary {
      background: #1677ff;
    }
    .action-chip.success {
      background: #16a34a;
    }
    .action-chip.danger {
      background: #d92d20;
    }
    .action-chip:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }
    .inline-form {
      display: inline-flex;
      margin: 0;
    }
    .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .mini-input {
      width: 84px;
      height: 30px;
      border: 1px solid #d0d5dd;
      border-radius: 7px;
      padding: 0 8px;
      font-size: 13px;
      margin: 0;
      background: #fff;
      font-family: inherit;
    }
    .mini-input.wide {
      width: 150px;
    }
    .mini-input.full {
      width: 100%;
    }
    .mini-input.remark {
      width: 132px;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
      margin-top: 10px;
    }
    .stacked-form {
      display: grid;
      gap: 8px;
      max-width: 520px;
    }
    .compact-form {
      display: grid;
      gap: 7px;
      min-width: 220px;
      max-width: 300px;
    }
    .inline-label {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .timeline-list,
    .candidate-list {
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 6px;
    }
    .timeline-list li,
    .candidate-list li {
      border: 1px solid #eef0f5;
      border-radius: 7px;
      padding: 8px;
      background: #fafbfc;
    }
    .unread-dot {
      display: inline-flex;
      min-width: 18px;
      height: 18px;
      align-items: center;
      justify-content: center;
      margin-left: 6px;
      border-radius: 999px;
      background: #007aff;
      color: #fff;
      font-size: 11px;
      font-weight: 800;
    }
    .empty {
      padding: 18px 16px;
      color: var(--muted);
      font-size: 14px;
    }
    .realtime-toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 20;
      display: none;
      max-width: min(360px, calc(100vw - 36px));
      border: 1px solid #cfe5ff;
      border-radius: 8px;
      background: #eef6ff;
      color: #175cd3;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 700;
    }
    .realtime-toast.is-visible {
      display: block;
    }
    code {
      color: #344054;
      background: #f1f3f7;
      border: 1px solid #e4e7ec;
      border-radius: 6px;
      padding: 2px 6px;
      word-break: break-all;
    }
    ul { margin: 8px 0 0 18px; padding: 0; }
    @media (max-width: 640px) {
      header { padding: 14px 12px; }
      main { padding: 18px 12px 36px; }
      h1 { font-size: 22px; }
      nav { width: 100%; }
      nav a { flex: 1; text-align: center; }
    }
  </style>
</head>
<body>
  <header>
    <div class="top">
      <div class="brand"><span class="dot"></span><span>Temu ERP LAN</span></div>
      ${userHtml}
      <nav>${navHtml}</nav>
    </div>
  </header>
  <main>
    <div class="hero">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="subtitle">${escapeHtml(subtitle)}</p>
      </div>
      <span class="badge">服务运行中</span>
    </div>
    ${cardHtml ? `<div class="grid">${cardHtml}</div>` : ""}
    ${content}
  </main>
  <div id="realtime-toast" class="realtime-toast">数据已更新，正在刷新...</div>
  <script>
    (function () {
      if (!("WebSocket" in window)) return;
      var currentPath = ${JSON.stringify(currentPath || "")};
      var currentUserId = ${JSON.stringify(user?.id || null)};
      var retryCount = 0;
      var reloadTimer = null;
      var toastTimer = null;

      function showRealtimeToast(text) {
        var toast = document.getElementById("realtime-toast");
        if (!toast) return;
        if (text) toast.textContent = text;
        toast.classList.add("is-visible");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
          toast.classList.remove("is-visible");
        }, 2200);
      }

      function connectRealtimeSocket() {
        var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        var socket = new WebSocket(protocol + "//" + window.location.host + "/ws");
        socket.onopen = function () {
          retryCount = 0;
        };
        socket.onmessage = function (event) {
          var payload = null;
          try {
            payload = JSON.parse(event.data || "{}");
          } catch {
            return;
          }
          if (!payload) return;
          if (payload.type === "purchase:update") {
            if (currentPath !== "/purchase") return;
            showRealtimeToast("采购协作已更新，正在刷新...");
          } else if (payload.type === "user:update") {
            var isCurrentUser = payload.userId && currentUserId && payload.userId === currentUserId;
            if (isCurrentUser && payload.status && payload.status !== "active") {
              showRealtimeToast("当前账号已停用，正在退出...");
              window.clearTimeout(reloadTimer);
              reloadTimer = window.setTimeout(function () {
                window.location.href = "/logout";
              }, 700);
              return;
            }
            if (currentPath !== "/users" && !isCurrentUser) return;
            showRealtimeToast("用户信息已更新，正在刷新...");
          } else {
            return;
          }
          window.clearTimeout(reloadTimer);
          reloadTimer = window.setTimeout(function () {
            window.location.reload();
          }, 700);
        };
        socket.onclose = function () {
          retryCount += 1;
          window.setTimeout(connectRealtimeSocket, Math.min(10000, 1000 * retryCount));
        };
      }

      connectRealtimeSocket();
    })();
  </script>
</body>
</html>`;
}

function renderLoginPage({ error = "", next = "/" } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Temu ERP LAN 登录</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #f6f7fb;
      color: #1f2937;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .panel {
      width: min(100%, 400px);
      background: #fff;
      border: 1px solid #e6e8ef;
      border-radius: 10px;
      padding: 22px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
    }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0 0 18px; color: #667085; line-height: 1.7; }
    label { display: block; margin-bottom: 7px; color: #344054; font-weight: 650; }
    input {
      width: 100%;
      height: 42px;
      border: 1px solid #d0d5dd;
      border-radius: 8px;
      padding: 0 11px;
      font-size: 15px;
      margin-bottom: 14px;
    }
    .mini-input {
      width: 84px;
      height: 30px;
      border: 1px solid #d0d5dd;
      border-radius: 7px;
      padding: 0 8px;
      font-size: 13px;
      margin: 0;
    }
    .mini-input.remark {
      width: 132px;
    }
    button {
      width: 100%;
      height: 42px;
      border: 0;
      border-radius: 8px;
      background: #007aff;
      color: #fff;
      font-size: 15px;
      font-weight: 750;
      cursor: pointer;
    }
    .error {
      margin-bottom: 14px;
      border: 1px solid #ffd5d5;
      background: #fff1f0;
      color: #b42318;
      border-radius: 8px;
      padding: 9px 10px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main class="panel">
    <h1>LAN 登录</h1>
    <p>使用 ERP 调试台里创建的用户和访问码登录。</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="/api/login">
      <input type="hidden" name="next" value="${escapeHtml(next)}" />
      <label for="login">用户 ID 或姓名</label>
      <input id="login" name="login" autocomplete="username" required />
      <label for="accessCode">访问码</label>
      <input id="accessCode" name="accessCode" type="password" autocomplete="current-password" required />
      <button type="submit">登录</button>
    </form>
  </main>
</body>
</html>`;
}

function writeHtml(res, html, statusCode = 200, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(html);
}

function getRequestPath(req) {
  try {
    const parsed = new URL(req.url || "/", "http://127.0.0.1");
    return parsed.pathname;
  } catch {
    return "/";
  }
}

function getRequestOrigin(req) {
  const host = String(req.headers.host || "").trim();
  if (!host) return "http://127.0.0.1";
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  return `${proto}://${host}`;
}

function getExtensionIngestToken() {
  return String(
    process.env.ERP_EXTENSION_INGEST_TOKEN
      || process.env.TEMU_EXTENSION_INGEST_TOKEN
      || "temu-jst-extension-v1"
  ).trim();
}

function readBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : String(req.headers["x-extension-token"] || "").trim();
}

function safeTokenEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function isExtensionIngestAuthorized(req) {
  const expected = getExtensionIngestToken();
  const actual = readBearerToken(req);
  return safeTokenEqual(actual, expected);
}

function buildLandingCards() {
  const status = getLanStatus();
  const urlList = [status.localUrl, ...status.lanUrls]
    .map((url) => `<li><code>${escapeHtml(url)}</code></li>`)
    .join("");
  return [
    {
      title: "服务地址",
      body: `<ul>${urlList || "<li>暂无可用地址</li>"}</ul>`,
    },
    {
      title: "已开放页面",
      body: "<ul><li>用户管理：<code>/users</code></li><li>采购工作台：<code>/purchase</code></li><li>仓库工作台：<code>/warehouse</code></li><li>QC 抽检：<code>/qc</code></li></ul>",
    },
    {
      title: "安全边界",
      body: "当前阶段已经启用 LAN 登录和角色权限。真实采购/仓库业务 API 会在后续工作台开发包接入。",
    },
  ];
}

function buildWorkspaceCards(kind) {
  const descriptions = {
    purchase: {
      title: "采购工作台",
      subtitle: "后续用于采购接收运营 PR、记录供应商货源、推进 PO 和付款审批。",
      items: ["待接采购申请", "供应商筛选", "采购单状态", "财务付款审批"],
    },
    warehouse: {
      title: "仓库工作台",
      subtitle: "后续用于仓管收货、核数、入库、拣货、打包和发货回填。",
      items: ["待到货", "入库批次", "待拣货", "发货回填"],
    },
    qc: {
      title: "QC 抽检工作台",
      subtitle: "后续用于运营抽检录入、按百分比判定通过/部分通过/失败。",
      items: ["待抽检批次", "不良数量", "不良率判定", "库存释放"],
    },
  };
  const meta = descriptions[kind] || descriptions.purchase;
  return {
    title: meta.title,
    subtitle: meta.subtitle,
    cards: [
      {
        title: "当前状态",
        body: "LAN 服务已经启动，页面路由必须登录后访问，并按用户角色控制入口。",
      },
      {
        title: "即将接入",
        body: `<ul>${meta.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
      },
      {
        title: "接口预留",
        body: "健康检查：<code>/health</code><br/>服务状态：<code>/api/status</code>",
      },
    ],
  };
}

function formatDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 10);
}

function formatMoney(value) {
  const number = Number(value || 0);
  return `¥${number.toFixed(2)}`;
}

function formatQty(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function statusClass(status) {
  if (["submitted", "pushed_pending_price", "pending_finance_approval", "pending", "approved_to_pay", "pending_arrival", "pending_qc", "pending_warehouse", "pending_ops_confirm"].includes(status)) {
    return "status-warn";
  }
  if (["buyer_processing", "sourced", "waiting_ops_confirm", "supplier_processing", "shipped", "trade_completed", "arrived", "counted", "in_progress", "picking", "packed", "shipped_out"].includes(status)) {
    return "status-info";
  }
  if (["active", "converted_to_po", "paid", "inbounded", "closed", "approved", "inbounded_pending_qc", "passed", "passed_with_observation", "partial_passed", "confirmed"].includes(status)) {
    return "status-ok";
  }
  if (["blocked", "rejected", "cancelled", "exception", "delayed", "quantity_mismatch", "damaged", "failed", "rework_required"].includes(status)) {
    return "status-danger";
  }
  return "";
}

function statusPill(status, labels) {
  const text = labels[status] || status || "-";
  return `<span class="status ${statusClass(status)}">${escapeHtml(text)}</span>`;
}

function renderSection({ title, subtitle, badge, table, empty }) {
  return `
    <section class="section">
      <div class="section-head">
        <div>
          <div class="section-title">${escapeHtml(title)}</div>
          <div class="section-subtitle">${escapeHtml(subtitle)}</div>
        </div>
        ${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ""}
      </div>
      ${table || `<div class="empty">${escapeHtml(empty || "暂无数据")}</div>`}
    </section>
  `;
}

function renderTable({ columns, rows, emptyText }) {
  if (!rows.length) {
    return `<div class="empty">${escapeHtml(emptyText || "暂无数据")}</div>`;
  }
  const head = columns.map((column) => `<th>${escapeHtml(column.title)}</th>`).join("");
  const body = rows.map((row) => `
    <tr>
      ${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}
    </tr>
  `).join("");
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderKeyValueSelectOptions(options, selected) {
  return options.map(([value, label]) => `
    <option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>
  `).join("");
}

function renderUserCreateForm() {
  return `
    <form class="stacked-form" method="post" action="/api/users/upsert">
      <div class="form-grid">
        <label class="inline-label">用户名称
          <input class="mini-input full" name="name" placeholder="例如：采购小王" required />
        </label>
        <label class="inline-label">角色
          <select class="mini-input full" name="role" required>
            ${renderKeyValueSelectOptions(USER_ROLE_OPTIONS, "buyer")}
          </select>
        </label>
        <label class="inline-label">状态
          <select class="mini-input full" name="status">
            ${renderKeyValueSelectOptions(Object.entries(USER_STATUS_LABELS), "active")}
          </select>
        </label>
        <label class="inline-label">访问码
          <input class="mini-input full" name="accessCode" type="password" autocomplete="new-password" required />
        </label>
      </div>
      <div class="actions">
        <button class="action-chip" type="submit">创建用户</button>
      </div>
    </form>
  `;
}

function renderUserEditForm(row, currentUser) {
  const isSelf = row.id === currentUser?.id;
  return `
    <div class="actions">
      <form class="compact-form" method="post" action="/api/users/upsert">
        <input type="hidden" name="id" value="${escapeHtml(row.id)}" />
        <label class="inline-label">名称
          <input class="mini-input full" name="name" value="${escapeHtml(row.name || "")}" required />
        </label>
        <label class="inline-label">角色
          <select class="mini-input full" name="role" required>
            ${renderKeyValueSelectOptions(USER_ROLE_OPTIONS, row.role)}
          </select>
        </label>
        <label class="inline-label">状态
          <select class="mini-input full" name="status">
            ${renderKeyValueSelectOptions(Object.entries(USER_STATUS_LABELS), row.status || "active")}
          </select>
        </label>
        <label class="inline-label">重设访问码
          <input class="mini-input full" name="accessCode" type="password" autocomplete="new-password" placeholder="留空不改" />
        </label>
        <button class="action-chip secondary" type="submit">保存</button>
      </form>
      <form class="inline-form" method="post" action="/api/users/upsert">
        <input type="hidden" name="id" value="${escapeHtml(row.id)}" />
        <input type="hidden" name="name" value="${escapeHtml(row.name || "")}" />
        <input type="hidden" name="role" value="${escapeHtml(row.role || "buyer")}" />
        <input type="hidden" name="status" value="${row.status === "active" ? "blocked" : "active"}" />
        <button class="action-chip ${row.status === "active" ? "danger" : "success"}" type="submit" ${isSelf && row.status === "active" ? "disabled" : ""}>
          ${row.status === "active" ? "停用" : "启用"}
        </button>
      </form>
    </div>
  `;
}

function renderUserManagement(users = [], currentUser = {}) {
  const rows = Array.isArray(users) ? users : [];
  const activeCount = rows.filter((row) => row.status === "active").length;
  const userTable = renderTable({
    rows,
    emptyText: "暂无系统用户",
    columns: [
      {
        title: "用户",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.name || "-")}</div>
          <div class="muted">${escapeHtml(row.id || "-")}</div>
        `,
      },
      { title: "角色", render: (row) => `<span class="status status-info">${escapeHtml(roleLabel(row.role))}</span>` },
      { title: "状态", render: (row) => statusPill(row.status, USER_STATUS_LABELS) },
      { title: "访问码", render: (row) => `<span class="status ${row.hasAccessCode ? "status-ok" : "status-warn"}">${row.hasAccessCode ? "已设置" : "未设置"}</span>` },
      { title: "更新", render: (row) => formatDate(row.updatedAt) },
      { title: "编辑", render: (row) => renderUserEditForm(row, currentUser) },
    ],
  });

  return [
    renderSection({
      title: "创建用户",
      subtitle: "新用户保存后无需重启服务，可立即用用户名称或 ID 登录。",
      table: `<div style="padding: 16px;">${renderUserCreateForm()}</div>`,
    }),
    renderSection({
      title: "系统用户",
      subtitle: "停用用户会立即失去网页登录会话；启用用户可以按角色访问对应工作台。",
      badge: `${rows.length} 个用户 / ${activeCount} 个启用`,
      table: userTable,
    }),
  ].join("");
}

function renderSinglePurchaseAccountCard(account, callbackUrl) {
  const id = account?.id || "";
  const label = account?.label || account?.memberId || account?.appKey || account?.id || "未命名";
  const appKey = account?.appKey || "";
  const memberId = account?.memberId || account?.resourceOwner || "";
  const statusText = account?.authorized ? "已授权" : (account?.configured ? "已配置 / 未授权" : "未配置");
  const statusClass = account?.authorized ? "status-ok" : "status-warn";
  const isDisabled = account?.status === "disabled";
  const canStartOAuth = Boolean(account?.configured && !isDisabled);
  const oauthLabel = account?.authorized ? "重新授权" : "去 1688 授权";
  const expiry = account?.accessTokenExpiresAt
    ? String(account.accessTokenExpiresAt).replace("T", " ").slice(0, 19)
    : "-";
  const refreshExpiry = account?.refreshTokenExpiresAt
    ? String(account.refreshTokenExpiresAt).replace("T", " ").slice(0, 19)
    : "-";
  return `
    <section class="card" style="${isDisabled ? "opacity: 0.65;" : ""}">
      <div class="card-title" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <span>${escapeHtml(label)}${isDisabled ? ' <span class="status status-warn">已禁用</span>' : ""}</span>
        <span class="status ${statusClass}">${escapeHtml(statusText)}</span>
      </div>
      <div class="card-body">
        <div class="muted">AppKey：<code>${escapeHtml(appKey || "-")}</code></div>
        <div class="muted">绑定账号：${escapeHtml(memberId || "-")}</div>
        <div class="muted">Access Token 到期：${escapeHtml(expiry)}</div>
        <div class="muted">Refresh Token 到期：${escapeHtml(refreshExpiry)}</div>
        <div class="muted" style="font-size: 11px;">ID：<code>${escapeHtml(id)}</code></div>

        <details style="margin-top: 12px;">
          <summary class="muted" style="cursor: pointer;">粘贴新 Access Token / 修改 Label</summary>
          <form class="stacked-form" method="post" action="/api/1688/token" style="margin-top: 8px;">
            <input type="hidden" name="purchase1688AccountId" value="${escapeHtml(id)}" />
            <div class="form-grid">
              <label class="inline-label">新 Access Token
                <input class="mini-input full" name="accessToken" type="password" autocomplete="new-password" placeholder="粘贴新 token 覆盖；留空不改" />
              </label>
              <label class="inline-label">账号别名 Label
                <input class="mini-input full" name="label" value="${escapeHtml(account?.label || "")}" placeholder="便于识别的别名" />
              </label>
              <label class="inline-label">到期时间
                <input class="mini-input full" name="accessTokenExpiresAt" placeholder="可选" />
              </label>
            </div>
            <div class="actions">
              <button class="action-chip success" type="submit">保存修改</button>
            </div>
          </form>
        </details>

        <div class="actions" style="margin-top: 8px;">
          <form class="inline-form" method="post" action="/api/1688/start" target="_blank">
            <input type="hidden" name="purchase1688AccountId" value="${escapeHtml(id)}" />
            <button class="action-chip success" type="submit" ${canStartOAuth ? "" : "disabled"}>${escapeHtml(oauthLabel)}</button>
          </form>
          <form class="inline-form" method="post" action="/api/1688/refresh">
            <input type="hidden" name="purchase1688AccountId" value="${escapeHtml(id)}" />
            <button class="action-chip" type="submit" ${account?.authorized ? "" : "disabled"}>刷新 Token</button>
          </form>
          <form class="inline-form" method="post" action="/api/1688/accounts/delete" onsubmit="return confirm('确定删除这个 1688 采购账号？被店铺设为默认时会被拒绝。');">
            <input type="hidden" name="id" value="${escapeHtml(id)}" />
            <button class="action-chip" style="border-color: #fecaca; color: #b91c1c;" type="submit">删除</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function render1688AuthPage(status = {}, requestOrigin = "", purchaseAccounts = []) {
  const origin = requestOrigin || "http://127.0.0.1";
  const defaultCallbackUrl = status.redirectUri || `${origin}/api/1688/oauth/callback`;
  const openPlatformUrl = "https://open.1688.com/";
  const accountCount = purchaseAccounts.length;

  const accountListHtml = accountCount === 0
    ? `<section class="card"><div class="card-body muted">还没有任何 1688 采购账号。用下面的「新增账号」表单开始添加。</div></section>`
    : purchaseAccounts.map((acct) => renderSinglePurchaseAccountCard(acct, defaultCallbackUrl)).join("");

  return `
    <section class="section">
      <div class="section-head">
        <div>
          <div class="section-title">1688 采购账号 (${accountCount})</div>
          <div class="section-subtitle">同一公司可以绑定多个 1688 买家账号，每个 Temu 店铺可以指定默认采购账号。客户端推单时按「显式选 → 店铺默认 → 公司第一个」三级取凭据。</div>
        </div>
      </div>
      <div style="padding: 16px; display: grid; gap: 14px;">
        <div class="grid" style="margin-bottom: 0;">
          ${accountListHtml}
        </div>

        <details>
          <summary class="action-chip" style="display: inline-block; cursor: pointer;">+ 新增 1688 采购账号</summary>
          <div style="padding: 12px 0;">
            <div class="muted" style="margin-bottom: 8px;">先在 1688 开放平台创建应用并把下面的回调地址填到应用里；保存 AppKey / AppSecret 后，可在账号卡片上直接跳转 1688 授权页。</div>
            <div class="actions" style="margin-bottom: 10px;">
              <a class="action-chip" href="${escapeHtml(openPlatformUrl)}" target="_blank" rel="noopener noreferrer">打开 1688 开放平台</a>
            </div>

            <form class="stacked-form" method="post" action="/api/1688/config" style="max-width: 760px;">
              <input type="hidden" name="mode" value="new" />
              <div class="form-grid">
                <label class="inline-label">AppKey
                  <input class="mini-input full" name="appKey" required placeholder="例如 4607218" />
                </label>
                <label class="inline-label">AppSecret
                  <input class="mini-input full" name="appSecret" type="password" autocomplete="new-password" required />
                </label>
                <label class="inline-label">账号别名 Label
                  <input class="mini-input full" name="label" placeholder="便于识别的别名（如 公司主账号 / 代采账号）" />
                </label>
                <label class="inline-label">回调地址
                  <input class="mini-input full" name="redirectUri" value="${escapeHtml(defaultCallbackUrl)}" required />
                </label>
              </div>
              <div class="actions">
                <button class="action-chip" type="submit">保存为新账号</button>
                <button class="action-chip success" type="submit" formaction="/api/1688/start" formtarget="_blank">保存并去 1688 授权</button>
              </div>
            </form>
          </div>
        </details>
      </div>
    </section>
  `;
}

function renderSkuCell(row) {
  return `
    <div class="primary-text">${escapeHtml(row.productName || row.skuSummary || row.poNo || "-")}</div>
    <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || row.skuSummary || "-")}</div>
  `;
}

function renderEvidence(row) {
  const evidence = Array.isArray(row.evidence) ? row.evidence.slice(0, 2) : [];
  if (!evidence.length) return '<span class="muted">-</span>';
  return `<div class="muted">${evidence.map((item) => escapeHtml(item)).join("<br/>")}</div>`;
}

function renderPaymentAction(row, user) {
  const role = user?.role || "";
  if (row.paymentApprovalStatus === "pending" || row.poStatus === "pending_finance_approval") {
    if (!canRole(role, ["finance", "manager", "admin"])) return renderUnavailableAction("待财务");
    return renderActionButton({
      action: "approve_payment",
      label: "财务批准",
      fields: {
        poId: row.poId,
        paymentApprovalId: row.paymentApprovalId,
      },
      className: "secondary",
    });
  }
  if (row.paymentApprovalStatus === "approved" || row.poStatus === "approved_to_pay") {
    if (!canRole(role, ["finance", "manager", "admin"])) return renderUnavailableAction("待付款");
    return renderActionButton({
      action: "confirm_paid",
      label: "确认已付款",
      fields: {
        poId: row.poId,
        paymentApprovalId: row.paymentApprovalId,
      },
      className: "success",
    });
  }
  return '<span class="status">查看</span>';
}

function canRole(role, allowedRoles) {
  return allowedRoles.includes(role);
}

function renderHiddenInputs(fields = {}) {
  return Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`)
    .join("");
}

function renderActionButton({ action, label, fields = {}, className = "", endpoint = "/api/purchase/action" }) {
  return `
    <form class="inline-form" method="post" action="${escapeHtml(endpoint)}">
      <input type="hidden" name="action" value="${escapeHtml(action)}" />
      ${renderHiddenInputs(fields)}
      <button class="action-chip ${escapeHtml(className)}" type="submit">${escapeHtml(label)}</button>
    </form>
  `;
}

function renderUnavailableAction(text = "等待") {
  return `<span class="status">${escapeHtml(text)}</span>`;
}

function renderSelectOptions(rows = [], valueKey = "id", labelFn = (row) => row.name || row.id, emptyLabel = "请选择") {
  return [
    `<option value="">${escapeHtml(emptyLabel)}</option>`,
    ...rows.map((row) => `<option value="${escapeHtml(row[valueKey])}">${escapeHtml(labelFn(row))}</option>`),
  ].join("");
}

function renderCreatePurchaseRequestForm(model = {}, user = {}) {
  const role = user?.role || "";
  if (!canRole(role, ["operations", "manager", "admin"])) return "";
  const skuOptions = Array.isArray(model.skuOptions) ? model.skuOptions : [];
  return renderSection({
    title: "新建采购需求",
    subtitle: "运营端可在用户端直接提交采购需求，采购端会实时收到并处理。",
    badge: "运营端",
    table: `
      <form class="stacked-form" method="post" action="/api/purchase/action">
        <input type="hidden" name="action" value="create_pr" />
        <label class="inline-label">SKU
          <select class="mini-input full" name="skuId" required>
            ${renderSelectOptions(skuOptions, "id", (sku) => `${sku.internalSkuCode || "-"} · ${sku.productName || "-"}`, "选择 SKU")}
          </select>
        </label>
        <div class="form-grid">
          <label class="inline-label">需求数量
            <input class="mini-input full" name="requestedQty" type="number" min="1" step="1" value="1" required />
          </label>
          <label class="inline-label">目标单价
            <input class="mini-input full" name="targetUnitCost" type="number" min="0" step="0.01" placeholder="可选" />
          </label>
          <label class="inline-label">期望到货
            <input class="mini-input full" name="expectedArrivalDate" type="date" />
          </label>
        </div>
        <label class="inline-label">需求原因
          <input class="mini-input full" name="reason" placeholder="活动备货 / 缺货补采 / 新品打样" required />
        </label>
        <label class="inline-label">证据或链接
          <input class="mini-input full" name="evidenceText" placeholder="截图说明、竞品链接、数据结论" />
        </label>
        <button class="action-chip" type="submit">提交采购需求</button>
      </form>
    `,
  });
}

function renderQuoteFeedbackForm(row, model = {}, user = {}) {
  const role = user?.role || "";
  if (!canRole(role, ["buyer", "manager", "admin"])) return "";
  if (!["submitted", "buyer_processing", "sourced"].includes(row.status)) return "";
  const supplierOptions = Array.isArray(model.supplierOptions) ? model.supplierOptions : [];
  return `
    <form class="compact-form" method="post" action="/api/purchase/action">
      <input type="hidden" name="action" value="quote_feedback" />
      <input type="hidden" name="prId" value="${escapeHtml(row.id)}" />
      <label class="inline-label">已有供应商
        <select class="mini-input full" name="supplierId">
          ${renderSelectOptions(supplierOptions, "id", (supplier) => supplier.name || supplier.id, "手填供应商")}
        </select>
      </label>
      <label class="inline-label">供应商名称
        <input class="mini-input full" name="supplierName" placeholder="未选已有供应商时填写" />
      </label>
      <div class="form-grid">
        <label class="inline-label">单价
          <input class="mini-input full" name="unitPrice" type="number" min="0" step="0.01" required />
        </label>
        <label class="inline-label">运费
          <input class="mini-input full" name="logisticsFee" type="number" min="0" step="0.01" value="0" />
        </label>
        <label class="inline-label">MOQ
          <input class="mini-input full" name="moq" type="number" min="1" step="1" value="1" />
        </label>
        <label class="inline-label">交期天数
          <input class="mini-input full" name="leadDays" type="number" min="0" step="1" />
        </label>
      </div>
      <input class="mini-input full" name="productUrl" placeholder="报价链接，可选" />
      <input class="mini-input full" name="remark" placeholder="报价说明，可选" />
      <button class="action-chip secondary" type="submit">报价反馈</button>
    </form>
  `;
}

function findPurchaseOrderForRequest(model = {}, prId) {
  const purchaseOrders = Array.isArray(model.purchaseOrders) ? model.purchaseOrders : [];
  return purchaseOrders.find((item) => item.prId === prId || item.pr_id === prId) || null;
}

function renderGeneratePoForm(row, user = {}, model = {}) {
  const role = user?.role || "";
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  if (!canRole(role, ["buyer", "manager", "admin"])) return "";
  const existingPo = findPurchaseOrderForRequest(model, row.id);
  if (existingPo || row.status === "converted_to_po") {
    const poNo = existingPo?.poNo || existingPo?.po_no || existingPo?.id || "";
    return `<span class="status">已生成采购单${poNo ? `：${escapeHtml(poNo)}` : ""}</span>`;
  }
  if (!candidates.length || !["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"].includes(row.status)) return "";
  return `
    <form class="compact-form" method="post" action="/api/purchase/action">
      <input type="hidden" name="action" value="generate_po" />
      <input type="hidden" name="prId" value="${escapeHtml(row.id)}" />
      <label class="inline-label">选择报价
        <select class="mini-input full" name="candidateId" required>
          ${renderSelectOptions(candidates, "id", (candidate) => `${candidate.supplierName || "供应商"} · ${formatMoney(candidate.unitPrice)} · MOQ ${formatQty(candidate.moq)}`, "选择报价")}
        </select>
      </label>
      <div class="form-grid">
        <label class="inline-label">采购数量
          <input class="mini-input full" name="qty" type="number" min="1" step="1" value="${escapeHtml(row.requestedQty || 1)}" required />
        </label>
        <label class="inline-label">预计到货
          <input class="mini-input full" name="expectedDeliveryDate" type="date" />
        </label>
      </div>
      <input class="mini-input full" name="remark" placeholder="采购单备注，可选" />
      <button class="action-chip success" type="submit">生成采购单</button>
    </form>
  `;
}

function renderCommentForm(row, user = {}) {
  const role = user?.role || "";
  if (!canRole(role, ["operations", "buyer", "manager", "admin"])) return "";
  return `
    <form class="compact-form" method="post" action="/api/purchase/action">
      <input type="hidden" name="action" value="add_comment" />
      <input type="hidden" name="prId" value="${escapeHtml(row.id)}" />
      <input class="mini-input full" name="body" placeholder="留言给对方" required />
      <button class="action-chip" type="submit">发送留言</button>
    </form>
  `;
}

function renderCandidateList(row) {
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  if (!candidates.length) return '<span class="muted">暂无报价</span>';
  return `
    <ul class="candidate-list">
      ${candidates.slice(0, 4).map((candidate) => `
        <li>
          <div class="primary-text">${escapeHtml(candidate.supplierName || "供应商")}</div>
          <div class="muted">单价 ${formatMoney(candidate.unitPrice)} · MOQ ${formatQty(candidate.moq)} · 交期 ${candidate.leadDays ? `${escapeHtml(candidate.leadDays)} 天` : "-"}</div>
          ${candidate.remark ? `<div class="muted">${escapeHtml(candidate.remark)}</div>` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function renderTimelineList(row) {
  const items = Array.isArray(row.timeline) ? row.timeline.slice(-5).reverse() : [];
  if (!items.length) return '<span class="muted">暂无协作记录</span>';
  return `
    <ul class="timeline-list">
      ${items.map((item) => `
        <li>
          <div>${escapeHtml(item.message || "-")}</div>
          <div class="muted">${escapeHtml(item.actorName || "系统")} · ${escapeHtml(item.actorRole || "-")} · ${formatDate(item.createdAt)}</div>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderPurchaseRequestActions(row, user, model = {}) {
  const role = user?.role || "";
  const actions = [];
  if (row.status === "submitted" && canRole(role, ["buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "accept_pr",
      label: "接收 PR",
      fields: { prId: row.id },
    }));
  }
  if (row.status === "buyer_processing" && canRole(role, ["buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "mark_sourced",
      label: "标记已找到货源",
      fields: { prId: row.id },
      className: "secondary",
    }));
  }
  return actions.length ? `<div class="actions">${actions.join("")}</div>` : renderUnavailableAction("无动作");
}

function renderPurchaseRequestActionsV2(row, user, model = {}) {
  const role = user?.role || "";
  const actions = [];
  if (row.status === "submitted" && canRole(role, ["buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "accept_pr",
      label: "接收",
      fields: { prId: row.id },
    }));
  }
  if (row.status === "buyer_processing" && canRole(role, ["buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "mark_sourced",
      label: "标记已找到货源",
      fields: { prId: row.id },
      className: "secondary",
    }));
  }
  if (Number(row.unreadCount || 0) > 0 && canRole(role, ["operations", "buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "mark_read",
      label: "标记已读",
      fields: { prId: row.id },
      className: "secondary",
    }));
  }
  actions.push(renderQuoteFeedbackForm(row, model, user));
  actions.push(renderGeneratePoForm(row, user, model));
  actions.push(renderCommentForm(row, user));
  const html = actions.filter(Boolean).join("");
  return html ? `<div class="actions">${html}</div>` : renderUnavailableAction("无待办");
}

function renderPurchaseOrderActions(row, user) {
  const role = user?.role || "";
  const actions = [];
  if (row.status === "draft" && canRole(role, ["buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "submit_payment_approval",
      label: "提交付款审批",
      fields: {
        poId: row.id,
        amount: row.totalAmount,
      },
    }));
  }
  if (row.status === "pending_finance_approval" && canRole(role, ["finance", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "approve_payment",
      label: "财务批准",
      fields: { poId: row.id },
      className: "secondary",
    }));
  }
  if (row.status === "approved_to_pay" && canRole(role, ["finance", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "confirm_paid",
      label: "确认已付款",
      fields: { poId: row.id },
      className: "success",
    }));
  }
  return actions.length ? `<div class="actions">${actions.join("")}</div>` : renderUnavailableAction("无动作");
}

function buildPurchaseSummaryCards(model) {
  const summary = model.summary || {};
  return [
    {
      title: "采购申请",
      body: `<div class="primary-text">${formatQty(summary.pendingPurchaseRequestCount)} 个待处理</div><div class="muted">列表共 ${formatQty(summary.purchaseRequestCount)} 条 PR</div>`,
    },
    {
      title: "采购单",
      body: `<div class="primary-text">${formatQty(summary.openPurchaseOrderCount)} 个未关闭</div><div class="muted">列表共 ${formatQty(summary.purchaseOrderCount)} 张 PO</div>`,
    },
    {
      title: "付款审批",
      body: `<div class="primary-text">${formatQty(summary.paymentQueueCount)} 个入口</div><div class="muted">待处理金额 ${formatMoney(summary.paymentQueueAmount)}</div>`,
    },
  ];
}

function renderPurchaseWorkbench(model = {}, user = {}) {
  const purchaseRequests = Array.isArray(model.purchaseRequests) ? model.purchaseRequests : [];
  const purchaseOrders = Array.isArray(model.purchaseOrders) ? model.purchaseOrders : [];
  const paymentQueue = Array.isArray(model.paymentQueue) ? model.paymentQueue : [];

  const requestTable = renderTable({
    rows: purchaseRequests,
    emptyText: "暂无采购申请。运营提交 PR 后会出现在这里。",
    columns: [
      { title: "SKU", render: renderSkuCell },
      { title: "状态", render: (row) => statusPill(row.status, PR_STATUS_LABELS) },
      {
        title: "申请",
        render: (row) => `
          <div class="primary-text">${formatQty(row.requestedQty)} 件</div>
          <div class="muted">${escapeHtml(row.reason || "-")} · ${escapeHtml(row.requestedByName || "-")}</div>
        `,
      },
      { title: "目标成本", render: (row) => formatMoney(row.targetUnitCost) },
      { title: "期望到货", render: (row) => formatDate(row.expectedArrivalDate) },
      { title: "证据", render: renderEvidence },
      {
        title: "货源",
        render: (row) => `
          <div class="primary-text">${formatQty(row.candidateCount)} 个候选</div>
          <div class="muted">已选 ${formatQty(row.selectedCandidateCount)}</div>
        `,
      },
      {
        title: "协作",
        render: (row) => `
          <div class="primary-text">报价 ${formatQty(row.candidateCount)}${row.unreadCount ? `<span class="unread-dot">${escapeHtml(row.unreadCount)}</span>` : ""}</div>
          ${renderCandidateList(row)}
          ${renderTimelineList(row)}
        `,
      },
      { title: "动作", render: (row) => renderPurchaseRequestActionsV2(row, user, model) },
    ],
  });

  const orderTable = renderTable({
    rows: purchaseOrders,
    emptyText: "暂无采购单。PR 确认后生成 PO。",
    columns: [
      {
        title: "采购单",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.poNo || row.id)}</div>
          <div class="muted">${escapeHtml(row.supplierName || "-")}</div>
        `,
      },
      { title: "状态", render: (row) => statusPill(row.status, PO_STATUS_LABELS) },
      {
        title: "SKU / 数量",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.skuSummary || "-")}</div>
          <div class="muted">${formatQty(row.receivedQty)} / ${formatQty(row.totalQty)} 已收</div>
        `,
      },
      { title: "金额", render: (row) => formatMoney(row.totalAmount) },
      { title: "付款", render: (row) => statusPill(row.paymentStatus, PAYMENT_STATUS_LABELS) },
      { title: "预计到货", render: (row) => formatDate(row.expectedDeliveryDate) },
      { title: "更新", render: (row) => formatDate(row.updatedAt) },
      { title: "动作", render: (row) => renderPurchaseOrderActions(row, user) },
    ],
  });

  const paymentTable = renderTable({
    rows: paymentQueue,
    emptyText: "暂无待审批付款。PO 提交付款审批后会出现在这里。",
    columns: [
      {
        title: "付款入口",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.paymentApprovalId || row.poNo || row.poId)}</div>
          <div class="muted">PO：${escapeHtml(row.poNo || row.poId || "-")}</div>
        `,
      },
      { title: "供应商", render: (row) => escapeHtml(row.supplierName || "-") },
      { title: "金额", render: (row) => formatMoney(row.paymentAmount ?? row.totalAmount) },
      {
        title: "审批状态",
        render: (row) => statusPill(row.paymentApprovalStatus || row.poStatus, {
          ...PAYMENT_STATUS_LABELS,
          ...PO_STATUS_LABELS,
        }),
      },
      { title: "申请人", render: (row) => escapeHtml(row.requestedByName || "-") },
      { title: "下一步", render: (row) => renderPaymentAction(row, user) },
    ],
  });

  return [
    renderCreatePurchaseRequestForm(model, user),
    renderSection({
      title: "采购申请列表",
      subtitle: "运营发起的 PR 在这里由采购接收、找货源、推进确认。",
      badge: `${purchaseRequests.length} 条`,
      table: requestTable,
    }),
    renderSection({
      title: "采购单列表",
      subtitle: "采购单用于跟踪财务审批、付款、供应商备货、到仓与入库。",
      badge: `${purchaseOrders.length} 张`,
      table: orderTable,
    }),
    renderSection({
      title: "付款审批入口",
      subtitle: "财务角色重点看这里；采购可以确认哪些 PO 已经进入付款链路。",
      badge: `${paymentQueue.length} 个`,
      table: paymentTable,
    }),
  ].join("");
}

function buildWarehouseSummaryCards(model) {
  const summary = model.summary || {};
  return [
    {
      title: "待到货",
      body: `<div class="primary-text">${formatQty(summary.pendingArrivalCount)} 单待确认</div><div class="muted">入库单共 ${formatQty(summary.inboundReceiptCount)} 张</div>`,
    },
    {
      title: "待核数 / 入库",
      body: `<div class="primary-text">${formatQty(summary.arrivedCount + summary.countedCount)} 单处理中</div><div class="muted">已收数量 ${formatQty(summary.receivedQty)} 件</div>`,
    },
  ];
}

function renderWarehouseReceiptActions(row, user) {
  const role = user?.role || "";
  if (!canRole(role, ["warehouse", "manager", "admin"])) return renderUnavailableAction("无权限");
  const actions = [];
  if (row.status === "pending_arrival") {
    actions.push(renderActionButton({
      endpoint: "/api/warehouse/action",
      action: "register_arrival",
      label: "确认到仓",
      fields: { receiptId: row.id },
    }));
  }
  if (row.status === "arrived") {
    actions.push(renderActionButton({
      endpoint: "/api/warehouse/action",
      action: "confirm_count",
      label: "确认核数",
      fields: { receiptId: row.id },
      className: "secondary",
    }));
  }
  return actions.length ? `<div class="actions">${actions.join("")}</div>` : renderUnavailableAction("无动作");
}

function renderWarehouseWorkbench(model = {}, user = {}) {
  const inboundReceipts = Array.isArray(model.inboundReceipts) ? model.inboundReceipts : [];

  const receiptTable = renderTable({
    rows: inboundReceipts,
    emptyText: "暂无待到货入库单。采购单发货后会进入这里。",
    columns: [
      {
        title: "入库单",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.receiptNo || row.id)}</div>
          <div class="muted">PO：${escapeHtml(row.poNo || row.poId || "-")}</div>
        `,
      },
      { title: "状态", render: (row) => statusPill(row.status, INBOUND_STATUS_LABELS) },
      {
        title: "供应商 / SKU",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.supplierName || "-")}</div>
          <div class="muted">${escapeHtml(row.skuSummary || "-")}</div>
        `,
      },
      {
        title: "数量",
        render: (row) => `
          <div class="primary-text">${formatQty(row.receivedQty)} / ${formatQty(row.expectedQty)} 已收</div>
          <div class="muted">破损 ${formatQty(row.damagedQty)} · 短少 ${formatQty(row.shortageQty)} · 多到 ${formatQty(row.overQty)}</div>
        `,
      },
      { title: "到仓", render: (row) => formatDate(row.receivedAt) },
      { title: "动作", render: (row) => renderWarehouseReceiptActions(row, user) },
    ],
  });

  return [
    renderSection({
      title: "待到货 / 入库单",
      subtitle: "仓管在这里确认到仓、核对数量，并对照采购单查看入库数据。",
      badge: `${inboundReceipts.length} 张`,
      table: receiptTable,
    }),
  ].join("");
}

function formatPercent(value) {
  const number = Number(value || 0);
  return `${(number * 100).toFixed(1)}%`;
}

function buildQcSummaryCards(model) {
  const summary = model.summary || {};
  return [
    {
      title: "待抽检批次",
      body: `<div class="primary-text">${formatQty(summary.pendingBatchCount)} 个</div><div class="muted">锁定数量 ${formatQty(summary.blockedQty)} 件</div>`,
    },
    {
      title: "QC 进行中",
      body: `<div class="primary-text">${formatQty(summary.inProgressCount)} 单</div><div class="muted">待开始 ${formatQty(summary.pendingQcCount)} 单</div>`,
    },
    {
      title: "已判定",
      body: `<div class="primary-text">${formatQty(summary.completedCount)} 单</div><div class="muted">通过/部分通过/失败都会回写批次库存</div>`,
    },
  ];
}

function renderQcStartAction(row, user) {
  const role = user?.role || "";
  if (!canRole(role, ["operations", "manager", "admin"])) return renderUnavailableAction("无权限");
  if (row.qcStatusValue === "in_progress") return renderUnavailableAction("抽检中");
  return renderActionButton({
    endpoint: "/api/qc/action",
    action: "start_qc",
    label: "开始抽检",
    fields: {
      batchId: row.id,
      qcId: row.qcId,
    },
  });
}

function renderQcSubmitForm(row, user) {
  const role = user?.role || "";
  if (!canRole(role, ["operations", "manager", "admin"])) return renderUnavailableAction("无权限");
  const qcId = row.qcId || row.id;
  const batchId = row.batchId || row.id;
  const suggested = Number(row.suggestedSampleQty || row.actualSampleQty || 20);
  return `
    <form class="actions" method="post" action="/api/qc/action">
      <input type="hidden" name="action" value="submit_qc_percent" />
      <input type="hidden" name="qcId" value="${escapeHtml(qcId)}" />
      <input type="hidden" name="batchId" value="${escapeHtml(batchId)}" />
      <input class="mini-input" name="actualSampleQty" type="number" min="1" step="1" value="${escapeHtml(suggested || 1)}" title="抽检数" required />
      <input class="mini-input" name="defectiveQty" type="number" min="0" step="1" value="${escapeHtml(row.defectiveQty || row.qcDefectiveQty || 0)}" title="不良数" required />
      <input class="mini-input remark" name="remark" placeholder="备注" />
      <button class="action-chip success" type="submit">提交判定</button>
    </form>
  `;
}

function renderQcBatchAction(row, user) {
  if (row.qcStatusValue === "in_progress") return renderQcSubmitForm(row, user);
  return `<div class="actions">${renderQcStartAction(row, user)}${renderQcSubmitForm(row, user)}</div>`;
}

function renderQcInspectionAction(row, user) {
  if (row.status === "pending_qc") {
    return renderActionButton({
      endpoint: "/api/qc/action",
      action: "start_qc",
      label: "开始抽检",
      fields: {
        qcId: row.id,
        batchId: row.batchId,
      },
    });
  }
  if (row.status === "in_progress") {
    return renderQcSubmitForm(row, user);
  }
  return renderUnavailableAction("已判定");
}

function renderQcWorkbench(model = {}, user = {}) {
  const pendingBatches = Array.isArray(model.pendingBatches) ? model.pendingBatches : [];
  const inspections = Array.isArray(model.inspections) ? model.inspections : [];

  const batchTable = renderTable({
    rows: pendingBatches,
    emptyText: "暂无待抽检批次。仓库创建批次后会进入这里。",
    columns: [
      {
        title: "批次",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.batchCode || row.id)}</div>
          <div class="muted">${escapeHtml(row.receiptNo || "-")}</div>
        `,
      },
      {
        title: "SKU",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.productName || "-")}</div>
          <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || "-")}</div>
        `,
      },
      {
        title: "库存",
        render: (row) => `
          <div class="primary-text">${formatQty(row.receivedQty)} 件</div>
          <div class="muted">可用 ${formatQty(row.availableQty)} · 锁定 ${formatQty(row.blockedQty)}</div>
        `,
      },
      { title: "批次 QC", render: (row) => statusPill(row.qcStatus, BATCH_QC_STATUS_LABELS) },
      {
        title: "QC 单",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.qcId || "未创建")}</div>
          <div class="muted">${escapeHtml(row.inspectorName || "-")}</div>
        `,
      },
      { title: "抽检 / 不良", render: (row) => `${formatQty(row.actualSampleQty)} / ${formatQty(row.qcDefectiveQty)}` },
      { title: "操作", render: (row) => renderQcBatchAction(row, user) },
    ],
  });

  const inspectionTable = renderTable({
    rows: inspections,
    emptyText: "暂无 QC 单。",
    columns: [
      {
        title: "QC 单",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.id)}</div>
          <div class="muted">${escapeHtml(row.batchCode || row.batchId || "-")}</div>
        `,
      },
      {
        title: "SKU",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.productName || "-")}</div>
          <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || "-")}</div>
        `,
      },
      { title: "状态", render: (row) => statusPill(row.status, QC_STATUS_LABELS) },
      { title: "抽检 / 不良", render: (row) => `${formatQty(row.actualSampleQty)} / ${formatQty(row.defectiveQty)}` },
      { title: "不良率", render: (row) => formatPercent(row.defectRate) },
      {
        title: "释放 / 锁定",
        render: (row) => `${formatQty(row.releaseQty)} / ${formatQty(row.blockedQty)}`,
      },
      { title: "批次状态", render: (row) => statusPill(row.batchQcStatus, BATCH_QC_STATUS_LABELS) },
      { title: "操作", render: (row) => renderQcInspectionAction(row, user) },
    ],
  });

  return [
    renderSection({
      title: "待抽检批次",
      subtitle: "运营按简单百分比录入抽检数和不良数，系统自动判定通过、部分通过或失败。",
      badge: `${pendingBatches.length} 个`,
      table: batchTable,
    }),
    renderSection({
      title: "QC 记录",
      subtitle: "QC 判定结果会回写批次库存：通过释放库存，部分通过释放一部分，失败继续锁定。",
      badge: `${inspections.length} 单`,
      table: inspectionTable,
    }),
  ].join("");
}

function buildOutboundSummaryCards(model) {
  const summary = model.summary || {};
  return [
    {
      title: "可出库批次",
      body: `<div class="primary-text">${formatQty(summary.availableBatchCount)} 个</div><div class="muted">可用库存 ${formatQty(summary.availableQty)} 件</div>`,
    },
    {
      title: "仓库处理中",
      body: `<div class="primary-text">${formatQty(summary.pendingWarehouseCount + summary.pickingCount + summary.packedCount)} 单</div><div class="muted">待接收 / 拣货 / 已打包</div>`,
    },
    {
      title: "待运营确认",
      body: `<div class="primary-text">${formatQty(summary.pendingOpsConfirmCount)} 单</div><div class="muted">已发出后由运营确认出库完成</div>`,
    },
  ];
}

function renderCreateOutboundPlanForm(row, user) {
  const role = user?.role || "";
  if (!canRole(role, ["operations", "manager", "admin"])) return renderUnavailableAction("待运营");
  const maxQty = Math.max(1, Number(row.availableQty || 1));
  return `
    <form class="actions" method="post" action="/api/outbound/action">
      <input type="hidden" name="action" value="create_outbound_plan" />
      <input type="hidden" name="batchId" value="${escapeHtml(row.id)}" />
      <input class="mini-input" name="qty" type="number" min="1" max="${escapeHtml(maxQty)}" step="1" value="${escapeHtml(maxQty)}" title="出库数量" required />
      <input class="mini-input" name="boxes" type="number" min="1" step="1" value="1" title="箱数" />
      <input class="mini-input remark" name="remark" placeholder="备注" />
      <button class="action-chip" type="submit">创建计划</button>
    </form>
  `;
}

function renderOutboundShipmentActions(row, user) {
  const role = user?.role || "";
  const actions = [];
  if (row.status === "pending_warehouse" && canRole(role, ["warehouse", "manager", "admin"])) {
    actions.push(renderActionButton({
      endpoint: "/api/outbound/action",
      action: "start_picking",
      label: "开始拣货",
      fields: { outboundId: row.id },
    }));
  }
  if (row.status === "picking" && canRole(role, ["warehouse", "manager", "admin"])) {
    actions.push(`
      <form class="actions" method="post" action="/api/outbound/action">
        <input type="hidden" name="action" value="mark_packed" />
        <input type="hidden" name="outboundId" value="${escapeHtml(row.id)}" />
        <input class="mini-input" name="boxes" type="number" min="1" step="1" value="${escapeHtml(row.boxes || 1)}" title="箱数" />
        <button class="action-chip secondary" type="submit">打包完成</button>
      </form>
    `);
  }
  if (row.status === "packed" && canRole(role, ["warehouse", "manager", "admin"])) {
    actions.push(`
      <form class="actions" method="post" action="/api/outbound/action">
        <input type="hidden" name="action" value="confirm_shipped_out" />
        <input type="hidden" name="outboundId" value="${escapeHtml(row.id)}" />
        <input class="mini-input remark" name="logisticsProvider" placeholder="物流" />
        <input class="mini-input remark" name="trackingNo" placeholder="单号" />
        <button class="action-chip success" type="submit">确认发出</button>
      </form>
    `);
  }
  if (row.status === "pending_ops_confirm" && canRole(role, ["operations", "manager", "admin"])) {
    actions.push(renderActionButton({
      endpoint: "/api/outbound/action",
      action: "confirm_outbound_done",
      label: "确认完成",
      fields: { outboundId: row.id },
      className: "success",
    }));
  }
  return actions.length ? `<div class="actions">${actions.join("")}</div>` : renderUnavailableAction("等待");
}

function renderOutboundWorkbench(model = {}, user = {}) {
  const availableBatches = Array.isArray(model.availableBatches) ? model.availableBatches : [];
  const outboundShipments = Array.isArray(model.outboundShipments) ? model.outboundShipments : [];

  const batchTable = renderTable({
    rows: availableBatches,
    emptyText: "暂无可出库批次。QC 通过或部分通过后，可用库存会出现在这里。",
    columns: [
      {
        title: "批次",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.batchCode || row.id)}</div>
          <div class="muted">${escapeHtml(row.receiptNo || row.poNo || "-")}</div>
        `,
      },
      {
        title: "SKU",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.productName || "-")}</div>
          <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || "-")}</div>
        `,
      },
      {
        title: "库存",
        render: (row) => `
          <div class="primary-text">可用 ${formatQty(row.availableQty)}</div>
          <div class="muted">预留 ${formatQty(row.reservedQty)} · 锁定 ${formatQty(row.blockedQty)}</div>
        `,
      },
      { title: "QC", render: (row) => statusPill(row.qcStatus, BATCH_QC_STATUS_LABELS) },
      { title: "供应商", render: (row) => escapeHtml(row.supplierName || "-") },
      { title: "入库时间", render: (row) => formatDate(row.receivedAt) },
      { title: "出库计划", render: (row) => renderCreateOutboundPlanForm(row, user) },
    ],
  });

  const shipmentTable = renderTable({
    rows: outboundShipments,
    emptyText: "暂无出库/发货单。运营从可出库批次创建计划后会出现在这里。",
    columns: [
      {
        title: "发货单",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.shipmentNo || row.id)}</div>
          <div class="muted">${escapeHtml(row.id)}</div>
        `,
      },
      {
        title: "SKU / 批次",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.productName || "-")}</div>
          <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || "-")} · ${escapeHtml(row.batchCode || row.batchId || "-")}</div>
        `,
      },
      {
        title: "数量",
        render: (row) => `
          <div class="primary-text">${formatQty(row.qty)} 件</div>
          <div class="muted">${formatQty(row.boxes)} 箱</div>
        `,
      },
      { title: "状态", render: (row) => statusPill(row.status, OUTBOUND_STATUS_LABELS) },
      {
        title: "物流",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.logisticsProvider || "-")}</div>
          <div class="muted">${escapeHtml(row.trackingNo || "-")}</div>
        `,
      },
      {
        title: "处理人",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.warehouseOperatorName || "-")}</div>
          <div class="muted">运营确认：${escapeHtml(row.confirmedByName || "-")}</div>
        `,
      },
      { title: "动作", render: (row) => renderOutboundShipmentActions(row, user) },
    ],
  });

  return [
    renderSection({
      title: "可出库批次",
      subtitle: "运营从 QC 已放行的批次创建出库计划；创建后系统会预留库存，等待仓库处理。",
      badge: `${availableBatches.length} 个`,
      table: batchTable,
    }),
    renderSection({
      title: "出库 / 发货单",
      subtitle: "仓库负责拣货、打包和确认发出；发出后进入运营确认，运营确认后出库流程关闭。",
      badge: `${outboundShipments.length} 单`,
      table: shipmentTable,
    }),
  ].join("");
}

function createRequestHandler(options = {}) {
  const getErpStatus = options.getErpStatus || (() => ({}));
  let getPurchaseWorkbench = options.getPurchaseWorkbench || (() => ({
    summary: {},
    purchaseRequests: [],
    purchaseOrders: [],
    paymentApprovals: [],
    paymentQueue: [],
  }));
  const performPurchaseAction = options.performPurchaseAction || (() => {
    throw new Error("Purchase action handler is not available");
  });
  const db = options.db || null;
  let getWarehouseWorkbench = options.getWarehouseWorkbench || (() => ({
    summary: {},
    inboundReceipts: [],
    inventoryBatches: [],
  }));
  const performWarehouseAction = options.performWarehouseAction || (() => {
    throw new Error("Warehouse action handler is not available");
  });
  let getQcWorkbench = options.getQcWorkbench || (() => ({
    summary: {},
    pendingBatches: [],
    inspections: [],
  }));
  const performQcAction = options.performQcAction || (() => {
    throw new Error("QC action handler is not available");
  });
  let getOutboundWorkbench = options.getOutboundWorkbench || (() => ({
    summary: {},
    availableBatches: [],
    outboundShipments: [],
  }));
  const performOutboundAction = options.performOutboundAction || (() => {
    throw new Error("Outbound action handler is not available");
  });
  const performInventoryAction = options.performInventoryAction || (() => {
    throw new Error("Inventory action handler is not available");
  });

  // worker_threads 只读查询池：把重型 workbench 查询挪到后台线程，主线程事件循环不再被
  // 同步大查询（0.5-1.3s）冻住。只在云端（startErpHeadlessServer 传入 queryPool）启用；
  // 任意一步失败都降级回主线程直查，保证不因池故障丢功能。
  const queryPool = options.queryPool || null;
  if (queryPool) {
    const _wrapPool = (handlerName, original) => async (params) => {
      try {
        return JSON.parse(await queryPool.run(handlerName, params));
      } catch (error) {
        console.error(`[QueryPool] ${handlerName} fallback to main thread:`, error?.message || error);
        return original(params);
      }
    };
    getPurchaseWorkbench = _wrapPool("purchase_workbench", getPurchaseWorkbench);
    getWarehouseWorkbench = _wrapPool("warehouse_workbench", getWarehouseWorkbench);
    getQcWorkbench = _wrapPool("qc_workbench", getQcWorkbench);
    getOutboundWorkbench = _wrapPool("outbound_workbench", getOutboundWorkbench);
  }
  // purchase/workbench 透传快路开关（启动期定）：池开 + 无 store-scope 时，主路由直接用
  // worker 出的 JSON 字符串拼接响应 + 异步 gzip，跳过主线程 parse/stringify/gzipSync。
  const purchaseStringTransport = !!queryPool && _poolStringTransportEnabled();
  const listWorkItems = options.listWorkItems || (() => []);
  const getWorkItemStats = options.getWorkItemStats || (() => ({
    total: 0,
    active: 0,
    byOwnerRole: {},
    byStatus: {},
    byPriority: {},
  }));
  const generateWorkItems = options.generateWorkItems || (() => ({
    created: 0,
    updated: 0,
    resolved: 0,
    items: [],
  }));
  const updateWorkItemStatus = options.updateWorkItemStatus || (() => {
    throw new Error("Work item action handler is not available");
  });
  const listUsers = options.listUsers || (() => []);
  const upsertUser = options.upsertUser || (() => {
    throw new Error("User action handler is not available");
  });
  const listCompanies = options.listCompanies || (() => []);
  const getPermissionProfile = options.getPermissionProfile || (() => ({}));
  const resolveStoreScope = options.resolveStoreScope || (() => ({ enforce: false }));
  const upsertRolePermission = options.upsertRolePermission || (() => {
    throw new Error("Role permission handler is not available");
  });
  const upsertUserResourceScope = options.upsertUserResourceScope || (() => {
    throw new Error("User resource scope handler is not available");
  });
  const getPermissionAdminView = options.getPermissionAdminView || (() => ({ catalog: {}, rolePermissions: [], user: null }));
  const setRoleResourceAccess = options.setRoleResourceAccess || (() => {
    throw new Error("Role access handler is not available");
  });
  const setUserPermissionOverrides = options.setUserPermissionOverrides || (() => {
    throw new Error("User override handler is not available");
  });
  const setUserResourceScopes = options.setUserResourceScopes || (() => {
    throw new Error("User scope handler is not available");
  });
  const listAccounts = options.listAccounts || (() => []);
  const upsertAccount = options.upsertAccount || (() => {
    throw new Error("Account action handler is not available");
  });
  const deleteAccount = options.deleteAccount || (() => {
    throw new Error("Account delete handler is not available");
  });
  const listSuppliers = options.listSuppliers || (() => []);
  const createSupplier = options.createSupplier || (() => {
    throw new Error("Supplier action handler is not available");
  });
  const listSkus = options.listSkus || (() => []);
  const listSkuStockDetails = options.listSkuStockDetails || (() => ({ rows: [], total: 0 }));
  const listSku1688Sources = options.listSku1688Sources || (() => []);
  const listPurchaseReturns = options.listPurchaseReturns || (() => []);
  const getPurchaseReturnIds = options.getPurchaseReturnIds || (() => []);
  const listPurchaseRequestsForSync = options.listPurchaseRequestsForSync || (() => []);
  const getPurchaseRequestIds = options.getPurchaseRequestIds || (() => []);
  const listPurchaseReturnItems = options.listPurchaseReturnItems || (() => []);
  const getPurchaseReturnItemIds = options.getPurchaseReturnItemIds || (() => []);
  const performPurchaseReturnAction = options.performPurchaseReturnAction || (() => {
    throw new Error("Purchase return action handler is not available");
  });
  const listConsignAfterSales = options.listConsignAfterSales || (() => []);
  const getConsignAfterSaleIds = options.getConsignAfterSaleIds || (() => []);
  const listConsignAfterSaleItems = options.listConsignAfterSaleItems || (() => []);
  const getConsignAfterSaleItemIds = options.getConsignAfterSaleItemIds || (() => []);
  const confirmConsignAfterSaleReceipt = options.confirmConsignAfterSaleReceipt || (() => {
    throw new Error("Consign after-sale receipt handler is not available");
  });
  const listConsignAfterSaleReceipts = options.listConsignAfterSaleReceipts || (() => []);
  const listJstConsignDeliveries = options.listJstConsignDeliveries || (() => []);
  const countJstConsignDeliveries = options.countJstConsignDeliveries || ((params) => listJstConsignDeliveries({ ...params, limit: 500000, offset: 0 }).length);
  const listJstConsignDeliverItems = options.listJstConsignDeliverItems || (() => []);
  const getJstConsignDeliveryCacheStatus = options.getJstConsignDeliveryCacheStatus || (() => ({ count: 0, lastImportedAt: null, lastUpdatedAt: null }));
  const listJstOtherInout = options.listJstOtherInout || (() => []);
  const countJstOtherInout = options.countJstOtherInout || ((params) => listJstOtherInout({ ...params, limit: 500000, offset: 0 }).length);
  const listJstOtherInoutItems = options.listJstOtherInoutItems || (() => []);
  const getJstOtherInoutCacheStatus = options.getJstOtherInoutCacheStatus || (() => ({ count: 0, lastImportedAt: null, lastUpdatedAt: null }));
  const createSku = options.createSku || (() => {
    throw new Error("SKU action handler is not available");
  });
  const deleteSku = options.deleteSku || (() => {
    throw new Error("SKU delete handler is not available");
  });
  const saveSkuBundle = options.saveSkuBundle || (() => {
    throw new Error("SKU bundle handler is not available");
  });
  const listSkuBundleComponents = options.listSkuBundleComponents || (() => []);
  const get1688AuthStatus = options.get1688AuthStatus || (() => ({
    configured: false,
    authorized: false,
  }));
  const upsert1688AuthConfig = options.upsert1688AuthConfig || (() => {
    throw new Error("1688 auth config handler is not available");
  });
  const save1688ManualToken = options.save1688ManualToken || (() => {
    throw new Error("1688 token handler is not available");
  });
  const create1688AuthorizeUrl = options.create1688AuthorizeUrl || (() => {
    throw new Error("1688 auth start handler is not available");
  });
  const complete1688OAuth = options.complete1688OAuth || (() => {
    throw new Error("1688 auth callback handler is not available");
  });
  const refresh1688AccessToken = options.refresh1688AccessToken || (() => {
    throw new Error("1688 token refresh handler is not available");
  });
  const receive1688Message = options.receive1688Message || (() => {
    throw new Error("1688 message handler is not available");
  });
  const list1688PurchaseAccounts = options.list1688PurchaseAccounts || (() => ({ accounts: [] }));
  const bindTemuOpenApiMall = options.bindTemuOpenApiMall || (() => {
    throw new Error("Temu OpenAPI bind handler is not available");
  });
  const listTemuOpenApiMalls = options.listTemuOpenApiMalls || (() => ({ malls: [] }));
  const unbindTemuOpenApiMall = options.unbindTemuOpenApiMall || (() => {
    throw new Error("Temu OpenAPI unbind handler is not available");
  });
  const syncTemuOpenApiProducts = options.syncTemuOpenApiProducts || (() => {
    throw new Error("Temu OpenAPI product sync handler is not available");
  });
  const listTemuOpenApiProducts = options.listTemuOpenApiProducts || (() => ({ counts: [] }));
  const listAllTemuOpenApiProductsAsSkc = options.listAllTemuOpenApiProductsAsSkc || (() => ({ rows: [] }));
  const listAllTemuOpenApiSales = options.listAllTemuOpenApiSales || (() => ({ rows: [] }));
  const listTemuOpenApiRecordsBySource = options.listTemuOpenApiRecordsBySource || (() => ({ rows: [] }));
  const ingestJushuitanExtensionBatch = options.ingestJushuitanExtensionBatch || null;
  const validateSessionUser = options.validateSessionUser || null;
  const verifyLogin = options.verifyLogin || (() => null);

  return (req, res) => {
    handleRequest({
      req,
      res,
      getErpStatus,
      db,
      getPurchaseWorkbench,
      performPurchaseAction,
      getWarehouseWorkbench,
      performWarehouseAction,
      getQcWorkbench,
      performQcAction,
      getOutboundWorkbench,
      performOutboundAction,
      performInventoryAction,
      listWorkItems,
      getWorkItemStats,
      generateWorkItems,
      updateWorkItemStatus,
      listUsers,
      upsertUser,
      listCompanies,
      getPermissionProfile,
      resolveStoreScope,
      upsertRolePermission,
      upsertUserResourceScope,
      getPermissionAdminView,
      setRoleResourceAccess,
      setUserPermissionOverrides,
      setUserResourceScopes,
      listAccounts,
      upsertAccount,
      deleteAccount,
      listSuppliers,
      createSupplier,
      listSkus,
      listSkuStockDetails,
      listSku1688Sources,
      listPurchaseReturns,
      getPurchaseReturnIds,
      listPurchaseReturnItems,
      getPurchaseReturnItemIds,
      performPurchaseReturnAction,
      listConsignAfterSales,
      getConsignAfterSaleIds,
      listConsignAfterSaleItems,
      getConsignAfterSaleItemIds,
      confirmConsignAfterSaleReceipt,
      listConsignAfterSaleReceipts,
      listJstConsignDeliveries,
      countJstConsignDeliveries,
      listJstConsignDeliverItems,
      getJstConsignDeliveryCacheStatus,
      listJstOtherInout,
      countJstOtherInout,
      listJstOtherInoutItems,
      getJstOtherInoutCacheStatus,
      createSku,
      deleteSku,
      saveSkuBundle,
      listSkuBundleComponents,
      get1688AuthStatus,
      upsert1688AuthConfig,
      save1688ManualToken,
      create1688AuthorizeUrl,
      complete1688OAuth,
      refresh1688AccessToken,
      receive1688Message,
      list1688PurchaseAccounts,
      bindTemuOpenApiMall,
      listTemuOpenApiMalls,
      unbindTemuOpenApiMall,
      syncTemuOpenApiProducts,
      listTemuOpenApiProducts,
      listAllTemuOpenApiProductsAsSkc,
      listAllTemuOpenApiSales,
      listTemuOpenApiRecordsBySource,
      validateSessionUser,
      verifyLogin,
      queryPool,
      purchaseStringTransport,
    }).catch((error) => {
      writeJson(res, 500, {
        ok: false,
        error: error?.message || String(error),
      });
    });
  };
}

async function readRequestBody(req, maxBytes = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseRequestQuery(req) {
  try {
    const parsed = new URL(req.url || "/", "http://127.0.0.1");
    return Object.fromEntries(parsed.searchParams.entries());
  } catch {
    return {};
  }
}

async function readLoginPayload(req, maxBytes = 16 * 1024) {
  const body = await readRequestBody(req, maxBytes);
  const contentType = String(req.headers["content-type"] || "");
  if (contentType.includes("application/json")) {
    return body ? JSON.parse(body) : {};
  }
  const params = new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

async function readOptionalPayload(req, maxBytes = 16 * 1024) {
  if (req.method === "GET" || req.method === "HEAD") return {};
  return readLoginPayload(req, maxBytes);
}

function parse1688MessageBody(bodyText, contentType) {
  if (!bodyText) return {};
  if (String(contentType || "").includes("application/json")) {
    try {
      return JSON.parse(bodyText);
    } catch {
      return { raw: bodyText };
    }
  }
  const params = new URLSearchParams(bodyText);
  const payload = Object.fromEntries(params.entries());
  if (Object.keys(payload).length > 0) return payload;
  try {
    return JSON.parse(bodyText);
  } catch {
    return { raw: bodyText };
  }
}

function getRequestSourceIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || null;
}

async function handle1688MessageRequest({ req, res, receive1688Message }) {
  const query = parseRequestQuery(req);
  if (req.method === "GET" || req.method === "HEAD") {
    const payload = {
      ok: true,
      service: "temu-erp-1688-message",
      endpoint: "/api/1688/message",
    };
    if (query.response === "plain") {
      writeText(res, 200, "success");
      return;
    }
    writeJson(res, 200, payload);
    return;
  }
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const bodyText = await readRequestBody(req, 1024 * 1024);
  const payload = parse1688MessageBody(bodyText, req.headers["content-type"]);
  const message = await receive1688Message({
    headers: req.headers,
    query,
    payload,
    bodyText,
    sourceIp: getRequestSourceIp(req),
  });

  if (query.response === "plain") {
    writeText(res, 200, "success");
    return;
  }
  writeJson(res, 200, {
    ok: true,
    success: true,
    message: "success",
    id: message.id,
  });
}

async function handleLoginRequest({ req, res, verifyLogin }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  const lockMs = loginLockRemainingMs(req);
  if (lockMs > 0) {
    const secs = Math.ceil(lockMs / 1000);
    if (wantsJson) { writeJson(res, 429, { ok: false, error: `登录尝试过于频繁，请 ${secs} 秒后再试` }); return; }
    writeHtml(res, renderLoginPage({ error: `登录尝试过于频繁，请 ${secs} 秒后再试`, next: "/" }), 429);
    return;
  }
  let payload = {};
  try {
    payload = await readLoginPayload(req, 8 * 1024 * 1024);
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, { ok: false, error: error?.message || "Invalid login request" });
      return;
    }
    writeHtml(res, renderLoginPage({ error: "登录请求格式不正确", next: "/" }), 400);
    return;
  }

  const next = normalizeLocalNext(payload.next);
  const user = verifyLogin({
    login: payload.login,
    accessCode: payload.accessCode,
  });

  if (!user) {
    recordLoginFail(req);
    if (wantsJson) {
      writeJson(res, 401, { ok: false, error: "用户名或访问码错误" });
      return;
    }
    writeHtml(res, renderLoginPage({ error: "用户名或访问码错误", next }), 401);
    return;
  }

  clearLoginFail(req);
  const token = createSession(user);
  if (wantsJson) {
    writeJson(res, 200, { ok: true, user }, { "Set-Cookie": buildSessionCookie(token) });
    return;
  }
  writeRedirect(res, next, {
    "Set-Cookie": buildSessionCookie(token),
  });
}

async function handleUserUpsertRequest({ req, res, session, upsertUser }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readLoginPayload(req);
    if (!payload.id && !String(payload.accessCode || "").trim()) {
      throw new Error("新建用户必须设置访问码");
    }
    if (payload.role && !USER_ROLE_OPTIONS.some(([role]) => role === payload.role)) {
      throw new Error("用户角色无效");
    }
    if (payload.status && !Object.prototype.hasOwnProperty.call(USER_STATUS_LABELS, payload.status)) {
      throw new Error("用户状态无效");
    }
    if (payload.id === session.user.id && payload.status && payload.status !== "active") {
      throw new Error("不能停用当前登录用户");
    }
    const user = await upsertUser(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, user });
      return;
    }
    writeRedirect(res, "/users");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || null,
      });
      return;
    }
    writeHtml(res, renderShell({
      title: "用户保存失败",
      subtitle: error?.message || String(error),
      cards: [
        {
          title: "处理建议",
          body: "请确认用户名称、角色、状态和访问码是否填写完整。新建用户必须设置访问码，编辑用户时访问码可以留空。",
        },
        {
          title: "返回入口",
          body: '<a class="action-chip" href="/users">回到用户管理</a>',
        },
      ],
      currentPath: "/users",
      user: session.user,
    }), 400);
  }
}

function assertSessionRole(session, allowedRoles, actionName = "该操作") {
  const role = session?.user?.role;
  if (!allowedRoles.includes(role)) {
    const error = new Error(`${actionName}无权限：当前角色 ${role || "unknown"}`);
    error.statusCode = 403;
    throw error;
  }
}

async function buildMasterDataWorkbench({
  listAccounts,
  listSuppliers,
  listSkus,
  user,
  params = {},
}) {
  const companyId = user?.companyId;
  const scopedParams = {
    ...(params || {}),
    limit: Number(params?.limit) || 500,
    companyId,
  };
  // part 参数只查请求的段：客户端 list 调用都带 part（accounts/suppliers/skus），
  // 此前服务器忽略 part 三段全查全返，suppliers 4836 行 + skus 全字段同包 70MB+ 跨海必超时。
  // 不传 part 保持原全量行为。
  const part = String(params?.part || "").trim();
  const [accounts, suppliers, skus] = await Promise.all([
    !part || part === "accounts" ? Promise.resolve(listAccounts(scopedParams)) : Promise.resolve([]),
    !part || part === "suppliers" ? Promise.resolve(listSuppliers(scopedParams)) : Promise.resolve([]),
    !part || part === "skus" ? Promise.resolve(listSkus(scopedParams)) : Promise.resolve([]),
  ]);
  return {
    accounts,
    suppliers,
    skus,
  };
}

async function handleMasterDataActionRequest({
  req,
  res,
  session,
  upsertAccount,
  deleteAccount,
  createSupplier,
  createSku,
  deleteSku,
  saveSkuBundle,
  listSkuBundleComponents,
}) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readLoginPayload(req);
    const action = String(payload.action || "").trim();
    const scopedPayload = {
      ...payload,
      companyId: session.user.companyId,
    };
    let result = null;
    if (action === "upsert_account" || action === "create_account") {
      assertSessionRole(session, ["admin", "manager"], "账号保存");
      result = await upsertAccount(scopedPayload, session.user);
    } else if (action === "delete_account") {
      assertSessionRole(session, ["admin", "manager"], "店铺删除");
      result = await deleteAccount(scopedPayload, session.user);
    } else if (action === "create_supplier") {
      assertSessionRole(session, ["admin", "manager", "buyer"], "供应商创建");
      result = await createSupplier(scopedPayload, session.user);
    } else if (action === "create_sku") {
      assertSessionRole(session, ["admin", "manager", "operations"], "商品资料创建");
      result = await createSku(scopedPayload, session.user);
    } else if (action === "delete_sku") {
      assertSessionRole(session, ["admin", "manager", "operations"], "商品资料删除");
      result = await deleteSku(scopedPayload, session.user);
    } else if (action === "save_sku_bundle") {
      assertSessionRole(session, ["admin", "manager", "operations"], "组合装保存");
      result = await saveSkuBundle(scopedPayload, session.user);
    } else if (action === "list_sku_bundle_components") {
      assertSessionRole(session, ["admin", "manager", "operations"], "组合装明细");
      result = await listSkuBundleComponents(scopedPayload, session.user);
    } else {
      throw new Error(`不支持的商品资料操作：${action || "-"}`);
    }
    writeJson(res, 200, { ok: true, result });
  } catch (error) {
    writeJson(res, error?.statusCode || 400, {
      ok: false,
      error: error?.message || String(error),
    });
  }
}

function render1688Error(res, session, error, statusCode = 400) {
  writeHtml(res, renderShell({
    title: "1688 授权处理失败",
    subtitle: error?.message || String(error),
    cards: [
      {
        title: "处理建议",
        body: "请确认 AppKey、AppSecret、回调地址和 1688 开放平台应用配置一致，然后回到 1688 授权页重试。",
      },
      {
        title: "返回",
        body: '<a class="action-chip" href="/1688">回到 1688 授权</a>',
      },
    ],
    currentPath: "/1688",
    user: session?.user || null,
  }), statusCode);
}

async function handle1688ConfigRequest({ req, res, session, upsert1688AuthConfig }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req);
    const status = await upsert1688AuthConfig(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, status });
      return;
    }
    writeRedirect(res, "/1688");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || null,
        ...(Array.isArray(error?.occupants) ? { occupants: error.occupants } : {}),
      });
      return;
    }
    render1688Error(res, session, error, 400);
  }
}

async function handle1688TokenRequest({ req, res, session, save1688ManualToken }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req);
    const status = await save1688ManualToken(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, status });
      return;
    }
    writeRedirect(res, "/1688");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, { ok: false, error: error?.message || String(error) });
      return;
    }
    render1688Error(res, session, error, 400);
  }
}

async function handleTemuOpenApiBindRequest({ req, res, session, bindTemuOpenApiMall }) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req);
    const status = await bindTemuOpenApiMall(payload, session.user);
    writeJson(res, 200, { ok: true, status });
  } catch (error) {
    writeJson(res, 400, { ok: false, error: error?.message || String(error) });
  }
}

async function handle1688StartRequest({ req, res, session, create1688AuthorizeUrl }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req);
    const result = await create1688AuthorizeUrl(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, ...result });
      return;
    }
    writeRedirect(res, result.authUrl);
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, { ok: false, error: error?.message || String(error) });
      return;
    }
    render1688Error(res, session, error, 400);
  }
}

async function handle1688RefreshRequest({ req, res, session, refresh1688AccessToken }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req);
    const status = await refresh1688AccessToken(session.user, {
      purchase1688AccountId: payload?.purchase1688AccountId,
    });
    if (wantsJson) {
      writeJson(res, 200, { ok: true, status });
      return;
    }
    writeRedirect(res, "/1688");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, { ok: false, error: error?.message || String(error) });
      return;
    }
    render1688Error(res, session, error, 400);
  }
}

async function handle1688AccountDeleteRequest({ req, res, session, performPurchaseAction }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req);
    const id = String(payload?.id || "").trim();
    if (!id) throw new Error("id is required");
    await performPurchaseAction({
      action: "delete_1688_purchase_account",
      id,
    }, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, id });
      return;
    }
    writeRedirect(res, "/1688");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, { ok: false, error: error?.message || String(error) });
      return;
    }
    render1688Error(res, session, error, 400);
  }
}

async function handle1688OAuthCallback({ req, res, complete1688OAuth }) {
  const parsed = new URL(req.url || "/", "http://127.0.0.1");
  const error = parsed.searchParams.get("error");
  if (error) {
    render1688Error(res, null, new Error(parsed.searchParams.get("error_description") || error), 400);
    return;
  }

  try {
    const status = await complete1688OAuth({
      code: parsed.searchParams.get("code"),
      state: parsed.searchParams.get("state"),
    });
    writeHtml(res, renderShell({
      title: "1688 授权成功",
      subtitle: "云端已经保存 1688 Access Token，后续可以开始接商品、订单和物流接口。",
      cards: [
        {
          title: "绑定账号",
          body: `会员：<code>${escapeHtml(status.memberId || status.aliId || status.resourceOwner || "-")}</code><br/>Access Token 到期：<code>${escapeHtml(status.accessTokenExpiresAt || "-")}</code>`,
        },
        {
          title: "下一步",
          body: '<a class="action-chip" href="/1688">回到 1688 授权页</a>',
        },
      ],
      currentPath: "/1688",
      user: getSessionFromRequest(req)?.user || null,
    }));
  } catch (callbackError) {
    render1688Error(res, null, callbackError, 400);
  }
}

async function handlePurchaseActionRequest({ req, res, session, performPurchaseAction }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  let payload = {};
  try {
    const __t0 = Date.now();
    payload = await readLoginPayload(req, 8 * 1024 * 1024);
    const action = String(payload?.action || "");
    const __isImg = action === "source_1688_image";
    if (__isImg) console.error(`[handlePurchaseAction t=${Date.now() - __t0}ms] payload read, action=${action}`);
    const result = await performPurchaseAction(payload, session.user);
    if (__isImg) console.error(`[handlePurchaseAction t=${Date.now() - __t0}ms] action done`);
    if (wantsJson) {
      const body = { ok: true, result };
      const bodyText = JSON.stringify(body);
      if (__isImg) console.error(`[handlePurchaseAction t=${Date.now() - __t0}ms] writing json bodyLen=${bodyText.length}`);
      writeJson(res, 200, body);
      if (__isImg) console.error(`[handlePurchaseAction t=${Date.now() - __t0}ms] writeJson returned`);
      return;
    }
    writeRedirect(res, "/purchase");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || null,
        ...(Array.isArray(error?.occupants) ? { occupants: error.occupants } : {}),
      });
      return;
    }
    writeHtml(res, renderShell({
      title: "采购动作失败",
      subtitle: error?.message || String(error),
      cards: [
        {
          title: "处理建议",
          body: "请确认当前账号角色、单据状态和动作是否匹配，然后回到采购工作台重试。",
        },
        {
          title: "返回入口",
          body: '<a class="action-chip" href="/purchase">回到采购工作台</a>',
        },
      ],
      currentPath: "/purchase",
      user: session.user,
    }), 400);
  }
}

async function handleTemuSalesSyncRequest({ req, res, db }) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readLoginPayload(req, 64 * 1024);
    const { TemuCloudSalesSync } = require("./services/temuCloudSalesSync.cjs");
    const result = new TemuCloudSalesSync({
      db,
      attachCloudDb: attachTemuCloudDbIfPossible,
    }).sync(payload || {});
    writeJson(res, 200, { ok: true, result });
  } catch (error) {
    writeJson(res, error?.statusCode || 400, {
      ok: false,
      error: error?.message || String(error),
      code: error?.code || null,
    });
  }
}

async function handleTemuReviewsCloudSyncRequest({ req, res, db }) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req, 64 * 1024);
    const { TemuCloudReviewSync } = require("./services/temuCloudReviewSync.cjs");
    const sync = new TemuCloudReviewSync({
      db,
      attachCloudDb: attachTemuCloudDbIfPossible,
    });
    const result = sync.sync(payload || {});
    writeJson(res, 200, { ok: true, result });
  } catch (error) {
    writeJson(res, error?.statusCode || 400, {
      ok: false,
      error: error?.message || String(error),
      code: error?.code || null,
    });
  }
}

async function handleTemuJitVmiCloudSyncRequest({ req, res, db }) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req, 64 * 1024);
    const { TemuCloudJitVmiSync } = require("./services/temuCloudJitVmiSync.cjs");
    const sync = new TemuCloudJitVmiSync({
      db,
      attachCloudDb: attachTemuCloudDbIfPossible,
    });
    const result = sync.sync(payload || {});
    writeJson(res, 200, { ok: true, result });
  } catch (error) {
    writeJson(res, error?.statusCode || 400, {
      ok: false,
      error: error?.message || String(error),
      code: error?.code || null,
    });
  }
}

async function handleTemuImagesCloudSyncRequest({ req, res, db }) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req, 64 * 1024);
    const { TemuCloudImageSync } = require("./services/temuCloudImageSync.cjs");
    const sync = new TemuCloudImageSync({
      db,
      attachCloudDb: attachTemuCloudDbIfPossible,
    });
    const result = sync.sync(payload || {});
    writeJson(res, 200, { ok: true, result });
  } catch (error) {
    writeJson(res, error?.statusCode || 400, {
      ok: false,
      error: error?.message || String(error),
      code: error?.code || null,
    });
  }
}

async function handleTemuSettlementIncomeSyncRequest({ req, res, db }) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    await readLoginPayload(req, 64 * 1024);
    const {
      syncSettlementIncomeFromCapture,
      syncSettlementDetailFromCapture,
      syncFundDetailFromCapture,
      syncSettlementOrderDetailFromCapture,
      syncFundSummaryFromCapture,
      syncEprFeeFromCapture,
      syncFundFrozenFromCapture,
      syncAccountOverviewFromCapture,
      syncFulfillmentBillFromCapture,
      syncViolationFromCapture,
      clearMultiStoreReportCache,
    } = require("./services/multiStoreReport.cjs");
    const income = syncSettlementIncomeFromCapture(db, {
      attachCloudDb: attachTemuCloudDbIfPossible,
    });
    const detail = income.attached
      ? syncSettlementDetailFromCapture(db, { attachCloudDb: attachTemuCloudDbIfPossible })
      : { ok: false, attached: false, malls: 0, rows: 0 };
    // 对账中心账务明细（fund_detail）：售后赔付/仓储费/EPR/广告等费用（与 ipc.cjs 主控端对齐，原先漏同步）
    const fund = income.attached
      ? syncFundDetailFromCapture(db, { attachCloudDb: attachTemuCloudDbIfPossible })
      : { ok: false, attached: false, malls: 0, rows: 0 };
    const order = income.attached
      ? syncSettlementOrderDetailFromCapture(db, { attachCloudDb: attachTemuCloudDbIfPossible })
      : { ok: false, attached: false, malls: 0, rows: 0 };
    const fundSummary = income.attached
      ? syncFundSummaryFromCapture(db, { attachCloudDb: attachTemuCloudDbIfPossible })
      : { ok: false, attached: false, malls: 0, rows: 0 };
    // EPR 费用 / 资金限制 / 违规处罚（聚协云 P1+P2 对标）
    const epr = income.attached
      ? syncEprFeeFromCapture(db, { attachCloudDb: attachTemuCloudDbIfPossible })
      : { ok: false, attached: false, malls: 0, rows: 0 };
    const frozen = income.attached
      ? syncFundFrozenFromCapture(db, { attachCloudDb: attachTemuCloudDbIfPossible })
      : { ok: false, attached: false, malls: 0, rows: 0 };
    // 账户概览 / 履约费用流出（聚协云第①、⑧类对标）
    const accountOverview = income.attached
      ? syncAccountOverviewFromCapture(db, { attachCloudDb: attachTemuCloudDbIfPossible })
      : { ok: false, attached: false, malls: 0, rows: 0 };
    const fulfillment = income.attached
      ? syncFulfillmentBillFromCapture(db, { attachCloudDb: attachTemuCloudDbIfPossible })
      : { ok: false, attached: false, malls: 0, rows: 0 };
    const violation = income.attached
      ? syncViolationFromCapture(db, { attachCloudDb: attachTemuCloudDbIfPossible })
      : { ok: false, attached: false, malls: 0, rows: 0 };
    const totalRows = (Number(income.rows) || 0) + (Number(detail.rows) || 0) + (Number(fund.rows) || 0) + (Number(order.rows) || 0) + (Number(fundSummary.rows) || 0) + (Number(epr.rows) || 0) + (Number(frozen.rows) || 0) + (Number(accountOverview.rows) || 0) + (Number(fulfillment.rows) || 0) + (Number(violation.rows) || 0);
    if (totalRows > 0 && typeof clearMultiStoreReportCache === "function") {
      clearMultiStoreReportCache();
    }
    const result = {
      ok: Boolean(income.ok && detail.ok && fund.ok && order.ok && fundSummary.ok && epr.ok && frozen.ok && accountOverview.ok && fulfillment.ok && violation.ok),
      attached: income.attached,
      malls: Math.max(Number(income.malls) || 0, Number(detail.malls) || 0, Number(fund.malls) || 0, Number(order.malls) || 0, Number(fundSummary.malls) || 0, Number(epr.malls) || 0, Number(frozen.malls) || 0, Number(accountOverview.malls) || 0, Number(fulfillment.malls) || 0, Number(violation.malls) || 0),
      rows: totalRows,
      incomeRows: Number(income.rows) || 0,
      detailRows: Number(detail.rows) || 0,
      fundRows: Number(fund.rows) || 0,
      orderRows: Number(order.rows) || 0,
      fundSummaryRows: Number(fundSummary.rows) || 0,
      eprRows: Number(epr.rows) || 0,
      frozenRows: Number(frozen.rows) || 0,
      accountOverviewRows: Number(accountOverview.rows) || 0,
      fulfillmentRows: Number(fulfillment.rows) || 0,
      violationRows: Number(violation.rows) || 0,
      income,
      detail,
      fund,
      order,
      fundSummary,
      epr,
      frozen,
      violation,
    };
    writeJson(res, 200, { ok: true, result });
  } catch (error) {
    writeJson(res, error?.statusCode || 400, {
      ok: false,
      error: error?.message || String(error),
      code: error?.code || null,
    });
  }
}

async function handleMultiStoreReportRequest({ req, res, db }) {
  if (req.method !== "GET") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const parsed = new URL(req.url || "/", "http://127.0.0.1");
    const includeTest = parsed.searchParams.get("include_test") === "1";
    const { getMultiStoreReportFast } = require("./services/multiStoreReport.cjs");
    const data = await getMultiStoreReportFast(db, { includeTest, attachCloudDb: attachTemuCloudDbIfPossible });
    writeJson(res, 200, { ok: true, data });
  } catch (error) {
    writeJson(res, error?.statusCode || 500, {
      ok: false,
      error: error?.message || String(error),
    });
  }
}

// 纯查 erp_temu_malls 字典表（mall_id → store_code），不碰云端报表。
// client 模式售后页等用它把 mall_id 翻成「temu-0XX店铺」，云端崩了也能映射。
async function handleMallDictRequest({ req, res, db }) {
  if (req.method !== "GET") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const { _internal } = require("./services/multiStoreReport.cjs");
    const malls = _internal.readMallDictionary(db);
    writeJson(res, 200, { ok: true, data: { malls } });
  } catch (error) {
    writeJson(res, error?.statusCode || 500, {
      ok: false,
      error: error?.message || String(error),
    });
  }
}

async function handleWarehouseActionRequest({ req, res, session, performWarehouseAction }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readLoginPayload(req);
    const result = await performWarehouseAction(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, result });
      return;
    }
    writeRedirect(res, "/warehouse");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || null,
      });
      return;
    }
    writeHtml(res, renderShell({
      title: "仓库动作失败",
      subtitle: error?.message || String(error),
      cards: [
        {
          title: "处理建议",
          body: "请确认当前账号角色、入库单状态和动作是否匹配，然后回到仓库工作台重试。",
        },
        {
          title: "返回入口",
          body: '<a class="action-chip" href="/warehouse">回到仓库工作台</a>',
        },
      ],
      currentPath: "/warehouse",
      user: session.user,
    }), 400);
  }
}

async function handleQcActionRequest({ req, res, session, performQcAction }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readLoginPayload(req);
    const result = await performQcAction(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, result });
      return;
    }
    writeRedirect(res, "/qc");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || null,
      });
      return;
    }
    writeHtml(res, renderShell({
      title: "QC 动作失败",
      subtitle: error?.message || String(error),
      cards: [
        {
          title: "处理建议",
          body: "请确认当前账号角色、QC 单状态、抽检数和不良数是否正确，然后回到 QC 工作台重试。",
        },
        {
          title: "返回入口",
          body: '<a class="action-chip" href="/qc">回到 QC 工作台</a>',
        },
      ],
      currentPath: "/qc",
      user: session.user,
    }), 400);
  }
}

async function handleOutboundActionRequest({ req, res, session, performOutboundAction }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readLoginPayload(req);
    const result = await performOutboundAction(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, result });
      return;
    }
    writeRedirect(res, "/outbound");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || null,
      });
      return;
    }
    writeHtml(res, renderShell({
      title: "出库动作失败",
      subtitle: error?.message || String(error),
      cards: [
        {
          title: "处理建议",
          body: "请确认当前账号角色、发货单状态、库存预留数量和动作是否匹配，然后回到出库/发货工作台重试。",
        },
        {
          title: "返回入口",
          body: '<a class="action-chip" href="/outbound">回到出库/发货工作台</a>',
        },
      ],
      currentPath: "/outbound",
      user: session.user,
    }), 400);
  }
}

async function handleInventoryActionRequest({ req, res, session, performInventoryAction }) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req);
    const result = await performInventoryAction(payload, session.user);
    writeJson(res, 200, { ok: true, result });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error?.message || String(error),
      code: error?.code || null,
    });
  }
}

async function handleConsignAfterSaleActionRequest({ req, res, session, confirmConsignAfterSaleReceipt, listConsignAfterSaleReceipts }) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readLoginPayload(req);
    const action = String(payload.action || "");
    let result;
    if (action === "confirm_receipt") {
      result = await confirmConsignAfterSaleReceipt(payload, session.user);
    } else if (action === "list_receipts") {
      result = await listConsignAfterSaleReceipts(payload);
    } else {
      throw new Error(`Unsupported consign-after-sale action: ${action}`);
    }
    writeJson(res, 200, { ok: true, result });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error?.message || String(error),
      code: error?.code || null,
    });
  }
}

async function handleExtensionIngestRequest({ req, res, pathname, ingestJushuitanExtensionBatch }) {
  if (!isExtensionIngestAuthorized(req)) {
    writeJson(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }
  if (pathname === "/api/ingest/v1/health") {
    writeJson(res, 200, { ok: true, service: "temu-erp-extension-ingest", ts: Date.now() });
    return;
  }
  if (pathname === "/api/ingest/v1/heartbeat") {
    writeJson(res, 200, {
      ok: true,
      needs_reload: false,
      reload_version: 0,
      reconfig: null,
      reconfig_version: 0,
    });
    return;
  }
  if (pathname !== "/api/ingest/v1/batch") {
    writeJson(res, 404, { ok: false, error: "Not found" });
    return;
  }
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  if (typeof ingestJushuitanExtensionBatch !== "function") {
    writeJson(res, 503, { ok: false, error: "Extension ingest is not available" });
    return;
  }
  const payload = await readOptionalPayload(req, 25 * 1024 * 1024);
  const result = await ingestJushuitanExtensionBatch(payload, {
    role: "admin",
    companyId: payload.companyId || payload.company_id || "company_default",
  });
  writeJson(res, 200, { ok: true, ...result });
}

async function handleRequest({
  req,
  res,
  getErpStatus,
  db,
  getPurchaseWorkbench,
  performPurchaseAction,
  getWarehouseWorkbench,
  performWarehouseAction,
  getQcWorkbench,
  performQcAction,
  getOutboundWorkbench,
  performOutboundAction,
  performInventoryAction,
  listWorkItems,
  getWorkItemStats,
  generateWorkItems,
  updateWorkItemStatus,
  listUsers,
  upsertUser,
  listCompanies,
  getPermissionProfile,
  resolveStoreScope,
  upsertRolePermission,
  upsertUserResourceScope,
  getPermissionAdminView,
  setRoleResourceAccess,
  setUserPermissionOverrides,
  setUserResourceScopes,
  listAccounts,
  upsertAccount,
  deleteAccount,
  listSuppliers,
  createSupplier,
  listSkus,
  listSkuStockDetails,
  listSku1688Sources,
  listPurchaseReturns,
  getPurchaseReturnIds,
  listPurchaseReturnItems,
  getPurchaseReturnItemIds,
  performPurchaseReturnAction,
  listConsignAfterSales,
  getConsignAfterSaleIds,
  listConsignAfterSaleItems,
  getConsignAfterSaleItemIds,
  confirmConsignAfterSaleReceipt,
  listConsignAfterSaleReceipts,
  listJstConsignDeliveries,
  countJstConsignDeliveries,
  listJstConsignDeliverItems,
  getJstConsignDeliveryCacheStatus,
  listJstOtherInout,
  countJstOtherInout,
  listJstOtherInoutItems,
  getJstOtherInoutCacheStatus,
  createSku,
  deleteSku,
  saveSkuBundle,
  listSkuBundleComponents,
  get1688AuthStatus,
  upsert1688AuthConfig,
  save1688ManualToken,
  create1688AuthorizeUrl,
  complete1688OAuth,
  refresh1688AccessToken,
  receive1688Message,
  list1688PurchaseAccounts,
  bindTemuOpenApiMall,
  listTemuOpenApiMalls,
  unbindTemuOpenApiMall,
  syncTemuOpenApiProducts,
  listTemuOpenApiProducts,
  listAllTemuOpenApiProductsAsSkc,
  listAllTemuOpenApiSales,
  listTemuOpenApiRecordsBySource,
  validateSessionUser,
  verifyLogin,
  queryPool,
  purchaseStringTransport,
}) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Id",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "X-Content-Type-Options": "nosniff",
      });
      res.end();
      return;
    }

    const pathname = getRequestPath(req);
    if (pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === "/login") {
      const parsed = new URL(req.url || "/", "http://127.0.0.1");
      writeHtml(res, renderLoginPage({ next: normalizeLocalNext(parsed.searchParams.get("next")) }));
      return;
    }

    if (pathname === "/logout") {
      destroySession(req);
      writeRedirect(res, "/login", {
        "Set-Cookie": buildClearSessionCookie(),
      });
      return;
    }

    if (pathname === "/api/login") {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      await handleLoginRequest({ req, res, verifyLogin });
      return;
    }

    if (pathname === "/health") {
      writeJson(res, 200, {
        ok: true,
        service: "temu-erp-lan",
        name: os.hostname(),
        running: true,
        startedAt: lanState.startedAt,
      });
      return;
    }

    if (pathname === "/releases" || pathname.startsWith("/releases/")) {
      serveUpdateReleaseFile(req, res, pathname);
      return;
    }

    if (pathname.startsWith("/uploads/")) {
      serveUploadedFile(req, res, pathname);
      return;
    }

    if (pathname === "/api/status") {
      const session = getSessionFromRequest(req);
      writeJson(res, 200, {
        ok: true,
        lan: getLanStatus(),
        erp: getErpStatus(),
        user: session?.user || null,
      });
      return;
    }

    // /api/me：用 sessionCookie 反查当前登录用户（供多 agent 生图服务做 uid 隔离）。
    // 无有效 session 返 401。身份由服务端 session 确认，客户端无法伪造。
    if (pathname === "/api/me") {
      const session = getSessionFromRequest(req);
      if (!session || !session.user) {
        writeJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      const u = session.user;
      writeJson(res, 200, {
        ok: true,
        user: { id: u.id, name: u.name, role: u.role, companyId: u.companyId || null },
      });
      return;
    }

    if (pathname.startsWith("/api/ingest/v1/")) {
      await handleExtensionIngestRequest({
        req,
        res,
        pathname,
        ingestJushuitanExtensionBatch,
      });
      return;
    }

    if (pathname === "/api/1688/oauth/callback") {
      await handle1688OAuthCallback({
        req,
        res,
        complete1688OAuth,
      });
      return;
    }

    if (pathname === "/api/1688/message" || pathname === "/api/1688/message/health") {
      await handle1688MessageRequest({
        req,
        res,
        receive1688Message,
      });
      return;
    }

    const protectedPath = ROLE_PERMISSIONS[pathname] ? pathname : null;
    let session = protectedPath ? getSessionFromRequest(req) : null;
    let shouldClearSessionCookie = false;
    if (session && typeof validateSessionUser === "function") {
      const freshUser = await validateSessionUser(session.user?.id);
      if (!freshUser) {
        destroySession(req);
        session = null;
        shouldClearSessionCookie = true;
      } else {
        session.user = freshUser;
      }
    }
    if (protectedPath && !session) {
      if (pathname.startsWith("/api/")) {
        writeJson(res, 401, { ok: false, error: "Unauthorized" }, shouldClearSessionCookie ? { "Set-Cookie": buildClearSessionCookie() } : {});
        return;
      }
      writeRedirect(res, `/login?next=${encodeURIComponent(pathname)}`, shouldClearSessionCookie ? { "Set-Cookie": buildClearSessionCookie() } : {});
      return;
    }
    if (protectedPath && !isRoleAllowed(pathname, session.user.role)) {
      if (pathname.startsWith("/api/")) {
        writeJson(res, 403, { ok: false, error: "Forbidden" });
        return;
      }
      writeForbidden(res, session.user, pathname);
      return;
    }

    // 店铺数据隔离（阶段三）：对受保护接口，按当前用户「负责的店铺」范围裁剪响应里带店铺标识的数据。
    // 仅当 ENFORCE_STORE_SCOPE=1 且用户非特权、已限定店铺时挂 scope；其余情况 enforce=false，零影响。
    if (protectedPath && session?.user) {
      try {
        const scope = resolveStoreScope(session.user);
        if (scope && scope.enforce) res._storeScope = scope;
      } catch {
        // 解析失败不阻断请求：宁可这次不裁，也不能让接口 500。
      }
    }

    if (pathname === "/api/users/list") {
      writeJson(res, 200, {
        ok: true,
        users: await listUsers({ limit: 200, companyId: session.user.companyId }),
      });
      return;
    }

    if (pathname === "/api/users/upsert") {
      await handleUserUpsertRequest({
        req,
        res,
        session,
        upsertUser,
      });
      return;
    }

    if (pathname === "/api/companies/list") {
      writeJson(res, 200, {
        ok: true,
        companies: await listCompanies({ limit: 200 }),
      });
      return;
    }

    if (pathname === "/api/permissions/profile") {
      writeJson(res, 200, {
        ok: true,
        profile: await getPermissionProfile(session.user),
      });
      return;
    }

    if (pathname === "/api/permissions/role/upsert") {
      const payload = await readLoginPayload(req);
      writeJson(res, 200, {
        ok: true,
        permission: await upsertRolePermission(payload, session.user),
      });
      return;
    }

    if (pathname === "/api/permissions/scope/upsert") {
      const payload = await readLoginPayload(req);
      writeJson(res, 200, {
        ok: true,
        scope: await upsertUserResourceScope(payload, session.user),
      });
      return;
    }

    if (pathname === "/api/permissions/admin-view") {
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        view: await getPermissionAdminView(payload || {}),
      });
      return;
    }

    if (pathname === "/api/permissions/role/set-access") {
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        rolePermissions: await setRoleResourceAccess(payload || {}, session.user),
      });
      return;
    }

    if (pathname === "/api/permissions/user/set-overrides") {
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        overrides: await setUserPermissionOverrides(payload || {}, session.user),
      });
      return;
    }

    if (pathname === "/api/permissions/user/set-scopes") {
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        scopes: await setUserResourceScopes(payload || {}, session.user),
      });
      return;
    }

    if (pathname === "/api/master-data/workbench") {
      const payload = await readOptionalPayload(req);
      const workbench = await buildMasterDataWorkbench({
        listAccounts,
        listSuppliers,
        listSkus,
        user: session.user,
        params: payload,
      });
      writeJson(res, 200, {
        ok: true,
        workbench,
        ...workbench,
      });
      return;
    }

    if (pathname === "/api/master-data/supplier-goods") {
      // supplierId 可选：不传返回全量货盘明细（供应商管理页主表），传则只返回该供应商名下货品
      const payload = await readOptionalPayload(req);
      const supplierId = String(payload?.supplierId || payload?.supplier_id || payload?.id || "").trim();
      const companyId = session.user?.companyId;
      const limit = Math.min(Number(payload?.limit) || 500, 10000);
      const conditions = [];
      if (supplierId) conditions.push("goods.supplier_id = @supplier_id");
      if (companyId) conditions.push("goods.company_id = @company_id");
      const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = db.prepare(`
        SELECT
          goods.*,
          supplier.address AS supplier_address,
          supplier.contact_name AS supplier_contact_name,
          supplier.phone AS supplier_phone,
          supplier.tags_json AS supplier_tags_json,
          supplier.tax_rate AS supplier_tax_rate
        FROM erp_feishu_supplier_goods goods
        LEFT JOIN erp_suppliers supplier ON supplier.id = goods.supplier_id
        ${whereSql}
        ORDER BY goods.source_table, goods.product_name
        LIMIT @limit
      `).all({ supplier_id: supplierId || undefined, company_id: companyId, limit });
      const goods = rows.map((r) => {
        let supplierTags = [];
        try { supplierTags = JSON.parse(r.supplier_tags_json || "[]"); } catch {}
        return {
          id: r.id,
          supplierId: r.supplier_id,
          supplierName: r.supplier_name,
          productName: r.product_name,
          productCode: r.product_code,
          colorSpec: r.color_spec,
          purchasePrice: r.purchase_price,
          alibabaUrl: r.alibaba_url,
          labelSize: r.label_size,
          shippingReq: r.shipping_req,
          purchaseMode: r.purchase_mode,
          shop: r.shop,
          sourceTable: r.source_table,
          imageUrl: r.image_url,
          supplierAddress: r.supplier_address,
          supplierContactName: r.supplier_contact_name,
          supplierPhone: r.supplier_phone,
          supplierTags,
          supplierTaxRate: r.supplier_tax_rate,
        };
      });
      writeJson(res, 200, { ok: true, goods });
      return;
    }

    if (pathname === "/api/master-data/sku-ids") {
      // 增量同步的删除对账端点：只返回当前未删除 SKU 的 id 全集（不含字段，
      // 22576 个 id raw ~700KB，writeJson gzip 后 ~100KB，一次跨海可接受）。
      // 客户端 cache.db 拿它跟本地 id diff，本地有、服务器没有的就是被硬删的，清缓存。
      // 排除 jst:sku: 污染前缀，跟 listSkus 护栏口径一致。
      const companyId = session.user?.companyId;
      const idRows = db.prepare(`
        SELECT id FROM erp_skus
        WHERE status != 'deleted'
          AND id NOT LIKE 'jst:sku:%'
          ${companyId ? "AND company_id = @company_id" : ""}
      `).all(companyId ? { company_id: companyId } : {});
      writeJson(res, 200, { ok: true, ids: idRows.map((row) => row.id) });
      return;
    }

    if (pathname === "/api/master-data/sku-stock-details") {
      const payload = await readOptionalPayload(req);
      const result = await listSkuStockDetails({
        ...(payload || {}),
        companyId: session.user?.companyId,
      }, session.user);
      writeJson(res, 200, { ok: true, result, ...result });
      return;
    }

    if (pathname === "/api/master-data/mappings") {
      // 映射增量同步：since 游标 + includeDeleted（拿软删行）+ 分页。
      // 复用 listSku1688Sources（与 purchase workbench 同口径，返回 camelCase）。
      const payload = await readOptionalPayload(req);
      const companyId = session.user?.companyId;
      const mappings = listSku1688Sources({
        since: payload?.since,
        includeDeleted: Boolean(payload?.includeDeleted),
        limit: Number(payload?.limit) || 1000,
        offset: Number(payload?.offset) || 0,
        companyId,
      });
      writeJson(res, 200, { ok: true, mappings });
      return;
    }

    if (pathname === "/api/master-data/mapping-ids") {
      // 映射删除对账端点：返回当前未删除映射的 id 全集，客户端 diff 出硬删的清缓存。
      const companyId = session.user?.companyId;
      const idRows = db.prepare(`
        SELECT source.id AS id
        FROM erp_sku_1688_sources source
        LEFT JOIN erp_skus sku ON sku.id = source.sku_id
        LEFT JOIN erp_accounts acct ON acct.id = source.account_id
        WHERE source.status != 'deleted'
          ${companyId ? "AND (sku.company_id = @company_id OR acct.company_id = @company_id)" : ""}
      `).all(companyId ? { company_id: companyId } : {});
      writeJson(res, 200, { ok: true, ids: idRows.map((row) => row.id) });
      return;
    }

    if (pathname === "/api/master-data/purchase-returns") {
      // 采购退货历史增量：since 游标 + includeDeleted + 分页。
      // 1062 单头数据量小，单次 limit 默认 1000 一次拉完；保留分页是为对齐 cache 框架。
      const payload = await readOptionalPayload(req);
      const companyId = session.user?.companyId;
      const rows = listPurchaseReturns({
        since: payload?.since,
        includeDeleted: Boolean(payload?.includeDeleted),
        limit: Number(payload?.limit) || 1000,
        offset: Number(payload?.offset) || 0,
        search: payload?.search || payload?.q,
        supplier: payload?.supplier,
        status: payload?.status,
        dateFrom: payload?.dateFrom,
        dateTo: payload?.dateTo,
        ioIds: Array.isArray(payload?.ioIds) ? payload.ioIds : null,
        companyId,
      });
      writeJson(res, 200, { ok: true, rows });
      return;
    }

    if (pathname === "/api/master-data/purchase-return-ids") {
      // 单头对账：客户端 diff 出硬删的清缓存（当前历史导入不会硬删，保留兜底）。
      const companyId = session.user?.companyId;
      const ids = getPurchaseReturnIds({ companyId });
      writeJson(res, 200, { ok: true, ids });
      return;
    }

    if (pathname === "/api/master-data/purchase-return-items") {
      // 明细增量：可按 since 全量增量，也可传 ioId / ioIds 按单头精确拉明细。
      const payload = await readOptionalPayload(req);
      const companyId = session.user?.companyId;
      const rows = listPurchaseReturnItems({
        since: payload?.since,
        includeDeleted: Boolean(payload?.includeDeleted),
        limit: Number(payload?.limit) || 2000,
        offset: Number(payload?.offset) || 0,
        ioId: payload?.ioId,
        ioIds: Array.isArray(payload?.ioIds) ? payload.ioIds : null,
        companyId,
      });
      writeJson(res, 200, { ok: true, rows });
      return;
    }

    if (pathname === "/api/master-data/purchase-return-item-ids") {
      const companyId = session.user?.companyId;
      const ids = getPurchaseReturnItemIds({ companyId });
      writeJson(res, 200, { ok: true, ids });
      return;
    }

    if (pathname === "/api/master-data/purchase-return/action") {
      // 手动采购退货单 action：create_draft / update_draft / effective / cancel / delete_draft。
      const payload = await readOptionalPayload(req);
      const result = performPurchaseReturnAction(
        { ...payload, companyId: payload?.companyId || session.user?.companyId },
        session.user,
      );
      writeJson(res, 200, { ok: true, result });
      return;
    }

    if (pathname === "/api/master-data/consign-after-sales") {
      // 送仓售后历史增量：since 游标 + includeDeleted + 分页。5483 单 head 量比采购退货大。
      const payload = await readOptionalPayload(req);
      const companyId = session.user?.companyId;
      const rows = listConsignAfterSales({
        since: payload?.since,
        includeDeleted: Boolean(payload?.includeDeleted),
        limit: Number(payload?.limit) || 1000,
        offset: Number(payload?.offset) || 0,
        search: payload?.search || payload?.q,
        shopName: payload?.shopName,
        status: payload?.status,
        dateFrom: payload?.dateFrom,
        dateTo: payload?.dateTo,
        asIds: Array.isArray(payload?.asIds) ? payload.asIds : null,
        companyId,
      });
      writeJson(res, 200, { ok: true, rows });
      return;
    }

    if (pathname === "/api/master-data/consign-after-sale-ids") {
      const companyId = session.user?.companyId;
      const ids = getConsignAfterSaleIds({ companyId });
      writeJson(res, 200, { ok: true, ids });
      return;
    }

    if (pathname === "/api/master-data/consign-after-sale-items") {
      // 送仓售后明细：可按 since 全量增量、也可按 asId / asIds 精确拉。
      const payload = await readOptionalPayload(req);
      const companyId = session.user?.companyId;
      const rows = listConsignAfterSaleItems({
        since: payload?.since,
        includeDeleted: Boolean(payload?.includeDeleted),
        limit: Number(payload?.limit) || 2000,
        offset: Number(payload?.offset) || 0,
        asId: payload?.asId,
        asIds: Array.isArray(payload?.asIds) ? payload.asIds : null,
        companyId,
      });
      writeJson(res, 200, { ok: true, rows });
      return;
    }

    if (pathname === "/api/master-data/consign-after-sale-item-ids") {
      const companyId = session.user?.companyId;
      const ids = getConsignAfterSaleItemIds({ companyId });
      writeJson(res, 200, { ok: true, ids });
      return;
    }

    if (pathname === "/api/master-data/consign-deliveries") {
      const payload = await readOptionalPayload(req);
      const companyId = session.user?.companyId;
      const params = {
        since: payload?.since,
        includeDeleted: Boolean(payload?.includeDeleted),
        limit: Number(payload?.limit) || 1000,
        offset: Number(payload?.offset) || 0,
        search: payload?.search || payload?.q,
        status: payload?.status,
        dateFrom: payload?.dateFrom,
        dateTo: payload?.dateTo,
        oIds: Array.isArray(payload?.oIds) ? payload.oIds : null,
        companyId,
      };
      const rows = listJstConsignDeliveries(params);
      const total = countJstConsignDeliveries(params);
      writeJson(res, 200, { ok: true, rows, total });
      return;
    }

    if (pathname === "/api/master-data/consign-deliver-items") {
      const payload = await readOptionalPayload(req);
      const companyId = session.user?.companyId;
      const rows = listJstConsignDeliverItems({
        includeDeleted: Boolean(payload?.includeDeleted),
        limit: Number(payload?.limit) || 2000,
        offset: Number(payload?.offset) || 0,
        oId: payload?.oId || payload?.o_id,
        companyId,
      });
      writeJson(res, 200, { ok: true, rows });
      return;
    }

    if (pathname === "/api/master-data/consign-deliver-cloud-items") {
      const payload = await readOptionalPayload(req);
      const mallId = payload?.mallId || payload?.mall_id;
      const soId = payload?.soId || payload?.so_id;
      let rows = [];
      if (mallId && soId) {
        const row = db.prepare("SELECT items_json FROM erp_temu_openapi_consign WHERE mall_id = ? AND so_id = ?").get(String(mallId), String(soId));
        if (row && row.items_json) { try { const a = JSON.parse(row.items_json); if (Array.isArray(a)) rows = a; } catch { /* */ } }
        // 合并逐 SKU 本地实发数(erp_consign_local_state.ship_qty_json)，供前端可编辑「发货数量」列回显。
        if (rows.length) {
          try {
            const st = db.prepare("SELECT ship_qty_json FROM erp_consign_local_state WHERE mall_id = ? AND so_id = ?").get(String(mallId), String(soId));
            let shipMap = {};
            if (st && st.ship_qty_json) { const m = JSON.parse(st.ship_qty_json); if (m && typeof m === "object") shipMap = m; }
            rows = rows.map((it) => ({ ...it, localShipQty: (it.skuId != null && shipMap[String(it.skuId)] != null) ? Number(shipMap[String(it.skuId)]) : null }));
          } catch { /* 表未建/解析失败：忽略，localShipQty 由前端兜底 */ }
        }
      }
      writeJson(res, 200, { ok: true, rows });
      return;
    }

    if (pathname === "/api/master-data/consign-deliveries-status") {
      const companyId = session.user?.companyId;
      writeJson(res, 200, {
        ok: true,
        ...getJstConsignDeliveryCacheStatus({ companyId }),
      });
      return;
    }

    if (pathname === "/api/master-data/consign-deliveries-unified") {
      const payload = await readOptionalPayload(req);
      const companyId = session.user?.companyId || payload?.companyId || "company_default";
      const result = runConsignDeliveriesUnified(db, {
        page: Number(payload?.page) || 1,
        pageSize: Number(payload?.pageSize) || 100,
        search: payload?.search || payload?.q || "",
        status: payload?.status || "",
        shop: payload?.shop || "",
        skuCode: payload?.skuCode || payload?.sku_code || "",
        dateFrom: payload?.dateFrom || payload?.date_from || "",
        dateTo: payload?.dateTo || payload?.date_to || "",
        source: payload?.source || "all",
        companyId,
      });
      writeJson(res, 200, result);
      return;
    }

    if (pathname === "/api/master-data/other-inout") {
      const payload = await readOptionalPayload(req);
      const companyId = session.user?.companyId;
      const params = {
        since: payload?.since,
        includeDeleted: Boolean(payload?.includeDeleted),
        limit: Number(payload?.limit) || 1000,
        offset: Number(payload?.offset) || 0,
        search: payload?.search || payload?.q,
        status: payload?.status,
        type: payload?.type,
        dateFrom: payload?.dateFrom,
        dateTo: payload?.dateTo,
        ioIds: Array.isArray(payload?.ioIds) ? payload.ioIds : null,
        companyId,
      };
      const rows = listJstOtherInout(params);
      const total = countJstOtherInout(params);
      writeJson(res, 200, { ok: true, rows, total });
      return;
    }

    if (pathname === "/api/master-data/other-inout-items") {
      const payload = await readOptionalPayload(req);
      const companyId = session.user?.companyId;
      const rows = listJstOtherInoutItems({
        includeDeleted: Boolean(payload?.includeDeleted),
        limit: Number(payload?.limit) || 2000,
        offset: Number(payload?.offset) || 0,
        ioId: payload?.ioId || payload?.io_id,
        companyId,
      });
      writeJson(res, 200, { ok: true, rows });
      return;
    }

    if (pathname === "/api/master-data/other-inout-status") {
      const companyId = session.user?.companyId;
      writeJson(res, 200, {
        ok: true,
        ...getJstOtherInoutCacheStatus({ companyId }),
      });
      return;
    }

    if (pathname === "/api/master-data/action") {
      await handleMasterDataActionRequest({
        req,
        res,
        session,
        upsertAccount,
        deleteAccount,
        createSupplier,
        createSku,
        deleteSku,
        saveSkuBundle,
        listSkuBundleComponents,
      });
      return;
    }

    if (pathname === "/api/1688/status") {
      writeJson(res, 200, {
        ok: true,
        status: await get1688AuthStatus(session.user),
      });
      return;
    }

    if (pathname === "/api/1688/config") {
      await handle1688ConfigRequest({
        req,
        res,
        session,
        upsert1688AuthConfig,
      });
      return;
    }

    if (pathname === "/api/1688/token") {
      await handle1688TokenRequest({
        req,
        res,
        session,
        save1688ManualToken,
      });
      return;
    }

    if (pathname === "/api/temu/openapi/status") {
      writeJson(res, 200, {
        ok: true,
        ...(await listTemuOpenApiMalls(session.user)),
      });
      return;
    }

    if (pathname === "/api/temu/openapi/bind") {
      await handleTemuOpenApiBindRequest({
        req,
        res,
        session,
        bindTemuOpenApiMall,
      });
      return;
    }

    if (pathname === "/api/temu/openapi/unbind") {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      try {
        const payload = await readLoginPayload(req);
        const result = await unbindTemuOpenApiMall(payload, session.user);
        writeJson(res, 200, { ok: true, ...result });
      } catch (error) {
        writeJson(res, 400, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/temu/openapi/products/sync") {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      try {
        const payload = await readLoginPayload(req);
        const result = await syncTemuOpenApiProducts(payload, session.user);
        writeJson(res, 200, { ok: true, ...result });
      } catch (error) {
        writeJson(res, 400, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/temu/openapi/products/skc") {
      try {
        const result = listAllTemuOpenApiProductsAsSkc({}, session.user);
        writeJson(res, 200, { ok: true, ...result });
      } catch (error) {
        writeJson(res, 400, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/temu/openapi/sales") {
      try {
        const result = listAllTemuOpenApiSales({}, session.user);
        writeJson(res, 200, { ok: true, ...result });
      } catch (error) {
        writeJson(res, 400, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/temu/openapi/records") {
      try {
        const source = new URL(req.url, "http://localhost").searchParams.get("source") || "";
        const result = listTemuOpenApiRecordsBySource({ source }, session.user);
        writeJson(res, 200, { ok: true, ...result });
      } catch (error) {
        writeJson(res, 400, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/temu/openapi/products") {
      try {
        const mallId = new URL(req.url, "http://localhost").searchParams.get("mallId") || "";
        const result = listTemuOpenApiProducts({ mallId }, session.user);
        writeJson(res, 200, { ok: true, ...result });
      } catch (error) {
        writeJson(res, 400, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/1688/start") {
      await handle1688StartRequest({
        req,
        res,
        session,
        create1688AuthorizeUrl,
      });
      return;
    }

    if (pathname === "/api/1688/refresh") {
      await handle1688RefreshRequest({
        req,
        res,
        session,
        refresh1688AccessToken,
      });
      return;
    }

    if (pathname === "/api/1688/accounts/delete") {
      await handle1688AccountDeleteRequest({
        req,
        res,
        session,
        performPurchaseAction,
      });
      return;
    }

    if (pathname === "/api/purchase/requests") {
      // 找品单增量同步：since 游标 + 分页（client 模式 purchaseRequestCache 的数据源）。
      // 富行与 /api/purchase/workbench 的 purchaseRequests 同口径，按 company 过滤。
      const payload = await readOptionalPayload(req);
      const requests = listPurchaseRequestsForSync({
        since: payload?.since,
        includeDeleted: Boolean(payload?.includeDeleted),
        limit: Number(payload?.limit) || 1000,
        offset: Number(payload?.offset) || 0,
        companyId: session.user?.companyId,
      });
      writeJson(res, 200, { ok: true, requests });
      return;
    }

    if (pathname === "/api/purchase/request-ids") {
      // 找品单删除对账端点：返回当前存在的找品单 id 全集，客户端 diff 出硬删的清缓存。
      const ids = getPurchaseRequestIds({ companyId: session.user?.companyId });
      writeJson(res, 200, { ok: true, ids });
      return;
    }

    if (pathname === "/api/purchase/workbench") {
      const __wbT0 = Date.now();
      const payload = await readOptionalPayload(req);
      const cacheKey = _purchaseWbCacheKey(payload, session.user);

      if (purchaseStringTransport) {
        // —— 透传快路：worker 出 workbench JSON 字符串 → 主线程字符串拼接（无大对象 parse/stringify）
        //    → 异步 gzip（不占事件循环）。pool 自带背压并发，去掉串行门。store-scope 已确认未启用。
        const cached = _purchaseWbCache.get(cacheKey);
        if (cached && cached.json) {
          const age = Date.now() - cached.ts;
          if (age < PURCHASE_WB_CACHE_TTL_MS) {
            writeRawJsonGzip(res, 200, cached.json);
            console.error(`[purchase/workbench] CACHE_HIT t=${Date.now() - __wbT0}ms bodyLen=${cached.len}`);
            return;
          }
          if (age < PURCHASE_WB_STALE_TTL_MS) {
            writeRawJsonGzip(res, 200, cached.json);
            console.error(`[purchase/workbench] STALE_HIT age=${age}ms t=${Date.now() - __wbT0}ms`);
            if (!_purchaseWbInflight.has(cacheKey)) {
              const bgPromise = queryPool.run("purchase_workbench", { ...payload, user: session.user })
                .then((wbStr) => {
                  const json = '{"ok":true,"workbench":' + wbStr + '}';
                  _purchaseWbCache.set(cacheKey, { json, ts: Date.now(), len: json.length });
                  console.error(`[purchase/workbench] BG_REVALIDATE bodyLen=${json.length}`);
                  return json;
                })
                .catch((e) => console.error(`[purchase/workbench] BG_REVALIDATE fail: ${e?.message || e}`))
                .finally(() => _purchaseWbInflight.delete(cacheKey));
              _purchaseWbInflight.set(cacheKey, bgPromise);
            }
            return;
          }
        }

        let jsonPromise = _purchaseWbInflight.get(cacheKey);
        if (!jsonPromise) {
          jsonPromise = queryPool.run("purchase_workbench", { ...payload, user: session.user })
            .then((wbStr) => {
              const json = '{"ok":true,"workbench":' + wbStr + '}';
              _purchaseWbCache.set(cacheKey, { json, ts: Date.now(), len: json.length });
              console.error(`[purchase/workbench] POOL_COMPUTE t=${Date.now() - __wbT0}ms bodyLen=${json.length}`);
              return json;
            })
            .finally(() => _purchaseWbInflight.delete(cacheKey));
          _purchaseWbInflight.set(cacheKey, jsonPromise);
        } else {
          console.error(`[purchase/workbench] DEDUP waiting on inflight key`);
        }
        let json;
        try {
          json = await jsonPromise;
        } catch (error) {
          // 池故障兜底：退回主线程对象路径，保证不因池异常给前端报错。
          console.error(`[purchase/workbench] POOL fail, fallback main thread: ${error?.message || error}`);
          const workbench = await getPurchaseWorkbench({ ...payload, user: session.user });
          writeJson(res, 200, { ok: true, workbench });
          return;
        }
        writeRawJsonGzip(res, 200, json);
        return;
      }

      // —— 对象路径（无池/降级，或 store-scope 启用需 writeJson 出口裁剪）：保持原逻辑。
      const cached = _purchaseWbCache.get(cacheKey);
      if (cached && cached.data) {
        const age = Date.now() - cached.ts;
        if (age < PURCHASE_WB_CACHE_TTL_MS) {
          writeJson(res, 200, cached.data);
          console.error(`[purchase/workbench] CACHE_HIT t=${Date.now() - __wbT0}ms bodyLen=${cached.len}`);
          return;
        }
        if (age < PURCHASE_WB_STALE_TTL_MS) {
          writeJson(res, 200, cached.data);
          console.error(`[purchase/workbench] STALE_HIT age=${age}ms t=${Date.now() - __wbT0}ms`);
          if (!_purchaseWbInflight.has(cacheKey)) {
            const bgPromise = Promise.resolve()
              .then(() => getPurchaseWorkbench({ ...payload, user: session.user }))
              .then((workbench) => {
                const body = { ok: true, workbench };
                const len = JSON.stringify(body).length;
                _purchaseWbCache.set(cacheKey, { data: body, ts: Date.now(), len });
                console.error(`[purchase/workbench] BG_REVALIDATE bodyLen=${len}`);
              })
              .finally(() => _purchaseWbInflight.delete(cacheKey));
            _purchaseWbInflight.set(cacheKey, bgPromise);
          }
          return;
        }
      }

      let resultPromise = _purchaseWbInflight.get(cacheKey);
      if (!resultPromise) {
        const prev = _purchaseWbGate;
        resultPromise = prev
          .catch(() => {})
          .then(() => getPurchaseWorkbench({ ...payload, user: session.user }))
          .then((workbench) => {
            const body = { ok: true, workbench };
            const bodyText = JSON.stringify(body);
            _purchaseWbCache.set(cacheKey, { data: body, ts: Date.now(), len: bodyText.length });
            console.error(`[purchase/workbench] COMPUTE sql=${Date.now() - __wbT0}ms bodyLen=${bodyText.length}`);
            return body;
          })
          .finally(() => _purchaseWbInflight.delete(cacheKey));
        _purchaseWbGate = resultPromise.catch(() => {});
        _purchaseWbInflight.set(cacheKey, resultPromise);
      } else {
        console.error(`[purchase/workbench] DEDUP waiting on inflight key`);
      }

      const body = await resultPromise;
      writeJson(res, 200, body);
      console.error(`[purchase/workbench] done t=${Date.now() - __wbT0}ms`);
      return;
    }

    if (pathname === "/api/purchase/action") {
      _clearPurchaseWbCache();
      await handlePurchaseActionRequest({
        req,
        res,
        session,
        performPurchaseAction,
      });
      return;
    }

    if (pathname === "/api/temu/sales-sync") {
      await handleTemuSalesSyncRequest({
        req,
        res,
        db,
      });
      return;
    }

    if (pathname === "/api/temu/jit-vmi-cloud-sync") {
      await handleTemuJitVmiCloudSyncRequest({
        req,
        res,
        db,
      });
      return;
    }

    if (pathname === "/api/temu/reviews-cloud-sync") {
      await handleTemuReviewsCloudSyncRequest({
        req,
        res,
        db,
      });
      return;
    }

    if (pathname === "/api/temu/images-cloud-sync") {
      await handleTemuImagesCloudSyncRequest({
        req,
        res,
        db,
      });
      return;
    }

    if (pathname === "/api/temu/settlement-income-sync") {
      await handleTemuSettlementIncomeSyncRequest({
        req,
        res,
        db,
      });
      return;
    }

    if (pathname === "/api/erp/reports/multi-store") {
      await handleMultiStoreReportRequest({ req, res, db });
      return;
    }

    if (pathname === "/api/erp/reports/mall-dict") {
      await handleMallDictRequest({ req, res, db });
      return;
    }

    if (pathname === "/api/erp/reports/sku-sales") {
      if (req.method !== "GET") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      try {
        const parsed = new URL(req.url || "/", "http://127.0.0.1");
        const includeTest = parsed.searchParams.get("include_test") === "1";
        const { buildSkuSales } = require("./services/multiStoreReport.cjs");
        const data = buildSkuSales(db, { includeTest, attachCloudDb: attachTemuCloudDbIfPossible });
        writeJson(res, 200, { ok: true, data });
      } catch (error) {
        writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/erp/reports/settlement") {
      if (req.method !== "GET") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      try {
        const parsed = new URL(req.url || "/", "http://127.0.0.1");
        const startDate = parsed.searchParams.get("start_date") || null;
        const endDate = parsed.searchParams.get("end_date") || null;
        const { querySettlementData } = require("./services/multiStoreReport.cjs");
        const data = querySettlementData(db, { startDate, endDate, attachCloudDb: attachTemuCloudDbIfPossible });
        writeJson(res, 200, { ok: true, data });
      } catch (error) {
        writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/erp/reports/pipeline-overview") {
      if (req.method !== "GET") { writeJson(res, 405, { ok: false, error: "Method not allowed" }); return; }
      try {
        const parsed = new URL(req.url || "/", "http://127.0.0.1");
        const force = parsed.searchParams.get("force") === "1";
        const svc = require("./services/multiStoreReport.cjs");
        const data = svc.buildPipelineOverview(db, { force, attachCloudDb: attachTemuCloudDbIfPossible });
        writeJson(res, 200, { ok: true, data });
      } catch (error) {
        writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/erp/reports/product-risk-tags") {
      if (req.method !== "POST") { writeJson(res, 405, { ok: false, error: "Method not allowed" }); return; }
      try {
        const p = await readOptionalPayload(req);
        const codes = p?.skuCodes || [];
        const svc = require("./services/multiStoreReport.cjs");
        const data = svc.buildProductRiskTags(db, { skuCodes: codes });
        writeJson(res, 200, { ok: true, data });
      } catch (error) {
        writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/erp/reports/risk-list" || pathname === "/api/erp/reports/activity-list" || pathname === "/api/erp/reports/shop-health" || pathname === "/api/erp/reports/stock-orders" || pathname === "/api/erp/reports/sales-trend" || pathname === "/api/erp/reports/product-panel" || pathname === "/api/erp/reports/product-trend" || pathname === "/api/erp/reports/purchase" || pathname === "/api/erp/reports/openapi-qc" || pathname === "/api/erp/reports/firstship-today" || pathname === "/api/erp/reports/goods-created-today" || pathname === "/api/erp/reports/quality-panel" || pathname === "/api/erp/reports/reviews" || pathname === "/api/erp/reports/high-price-flow" || pathname === "/api/erp/reports/warehouse-inventory") {
      if (req.method !== "GET") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      try {
        const parsed = new URL(req.url || "/", "http://127.0.0.1");
        const includeTest = parsed.searchParams.get("include_test") === "1";
        const productId = parsed.searchParams.get("product_id") || "";
        const svc = require("./services/multiStoreReport.cjs");
        const fn = pathname.endsWith("risk-list") ? svc.buildRiskList : pathname.endsWith("shop-health") ? svc.buildShopHealth : pathname.endsWith("stock-orders") ? svc.buildStockOrders : pathname.endsWith("sales-trend") ? svc.buildSalesTrend : pathname.endsWith("product-panel") ? svc.getProductPanelFast : pathname.endsWith("product-trend") ? svc.buildProductSalesTrend : pathname.endsWith("purchase") ? svc.buildPurchaseReport : pathname.endsWith("openapi-qc") ? svc.getOpenapiQcFast : pathname.endsWith("firstship-today") ? svc.buildFirstShipToday : pathname.endsWith("goods-created-today") ? svc.buildGoodsCreatedToday : pathname.endsWith("quality-panel") ? svc.getQualityPanelFast : pathname.endsWith("reviews") ? svc.buildReviews : pathname.endsWith("high-price-flow") ? svc.buildHighPriceFlowList : pathname.endsWith("warehouse-inventory") ? svc.buildWarehouseInventory : svc.buildActivityList;
        const data = fn(db, { includeTest, productId, attachCloudDb: attachTemuCloudDbIfPossible });
        writeJson(res, 200, { ok: true, data });
      } catch (error) {
        writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/erp/reports/qc-flaw-images") {
      if (req.method !== "GET") { writeJson(res, 405, { ok: false, error: "Method not allowed" }); return; }
      try {
        const parsed = new URL(req.url || "/", "http://127.0.0.1");
        const mallId = parsed.searchParams.get("mall_id") || "";
        const qcBillId = parsed.searchParams.get("qc_bill_id") || "";
        const svc = require("./services/multiStoreReport.cjs");
        const data = await svc.fetchQcFlawImages(db, { mallId, qcBillId });
        writeJson(res, 200, { ok: true, data });
      } catch (error) {
        writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    if (pathname === "/api/erp/reports/set-mall-owner") {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      try {
        const payload = await readOptionalPayload(req);
        const { setMallOwner } = require("./services/multiStoreReport.cjs");
        const changes = setMallOwner(db, payload?.mall_id, payload?.owner);
        writeJson(res, 200, { ok: true, data: { changes } });
      } catch (error) {
        writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    // 运营工作台「今日待办」闭环状态(跨用户共享)
    if (pathname === "/api/erp/op-task/list") {
      if (req.method !== "GET") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      try {
        const { listOpTaskState } = require("./services/multiStoreReport.cjs");
        writeJson(res, 200, { ok: true, data: listOpTaskState(db) });
      } catch (error) {
        writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (pathname === "/api/erp/op-task/set") {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      try {
        const payload = await readOptionalPayload(req);
        const { setOpTaskState } = require("./services/multiStoreReport.cjs");
        const changes = setOpTaskState(db, payload?.task_key, payload?.status ?? null, payload?.owner ?? null);
        writeJson(res, 200, { ok: true, data: { changes } });
      } catch (error) {
        writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) });
      }
      return;
    }

    // ===== 选品广场：实时搜索代理 + 选品池（读 /opt/temu-erp-data/yunqi_products.db）=====
    if (pathname === "/api/erp/reports/yunqi-search") {
      if (req.method !== "POST") { writeJson(res, 405, { ok: false, error: "Method not allowed" }); return; }
      try { const p = await readOptionalPayload(req); writeJson(res, 200, { ok: true, data: await require("./services/yunqiLiveProxy.cjs").liveSearch(p || {}) }); }
      catch (error) { writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) }); }
      return;
    }
    if (pathname === "/api/erp/reports/yunqi-token-status") {
      try { writeJson(res, 200, { ok: true, data: require("./services/yunqiLiveProxy.cjs").tokenStatus() }); }
      catch (error) { writeJson(res, 500, { ok: false, error: error?.message || String(error) }); }
      return;
    }
    if (pathname === "/api/erp/reports/yunqi-selection-list") {
      try { const status = new URL(req.url || "/", "http://127.0.0.1").searchParams.get("status") || ""; writeJson(res, 200, { ok: true, data: require("./services/yunqiCloud.cjs").listSelection({ status }) }); }
      catch (error) { writeJson(res, 500, { ok: false, error: error?.message || String(error) }); }
      return;
    }
    if (pathname === "/api/erp/reports/yunqi-selection-ids") {
      try { writeJson(res, 200, { ok: true, data: require("./services/yunqiCloud.cjs").listSelectionIds() }); }
      catch (error) { writeJson(res, 500, { ok: false, error: error?.message || String(error) }); }
      return;
    }
    if (pathname === "/api/erp/reports/yunqi-selection-add") {
      if (req.method !== "POST") { writeJson(res, 405, { ok: false, error: "Method not allowed" }); return; }
      try { const p = await readOptionalPayload(req); writeJson(res, 200, { ok: true, data: require("./services/yunqiCloud.cjs").addSelection(p?.item || p || {}) }); }
      catch (error) { writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) }); }
      return;
    }
    if (pathname === "/api/erp/reports/yunqi-selection-remove") {
      if (req.method !== "POST") { writeJson(res, 405, { ok: false, error: "Method not allowed" }); return; }
      try { const p = await readOptionalPayload(req); writeJson(res, 200, { ok: true, data: require("./services/yunqiCloud.cjs").removeSelection(p?.goodsId) }); }
      catch (error) { writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) }); }
      return;
    }
    if (pathname === "/api/erp/reports/yunqi-selection-update") {
      if (req.method !== "POST") { writeJson(res, 405, { ok: false, error: "Method not allowed" }); return; }
      try { const p = await readOptionalPayload(req); writeJson(res, 200, { ok: true, data: require("./services/yunqiCloud.cjs").updateSelection(p?.goodsId, { status: p?.status, note: p?.note }) }); }
      catch (error) { writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) }); }
      return;
    }

    // 选品广场：触发服务器云端抓取（无头登录云启 + 抓 + 存云端库），后台异步执行
    if (pathname === "/api/erp/reports/yunqi-sync") {
      if (req.method !== "POST") { writeJson(res, 405, { ok: false, error: "Method not allowed" }); return; }
      try {
        const p = await readOptionalPayload(req);
        const { spawn } = require("child_process");
        const env = { ...process.env, YQ_MAX_PAGES: String(Math.min(Math.max(Number(p?.maxPages) || 5, 1), 20)) };
        const kws = Array.isArray(p?.keywords) ? p.keywords.map((s) => String(s || "").trim()).filter(Boolean) : [];
        if (kws.length) env.YQ_KEYWORDS = kws.join(",");
        const child = spawn(process.execPath, ["--experimental-sqlite", "/opt/temu-automation/scripts/yunqi-cloud-fetch.mjs"], { cwd: "/opt/temu-automation", env, detached: true, stdio: "ignore" });
        child.unref();
        writeJson(res, 200, { ok: true, data: { triggered: true, message: "已触发服务器抓取(无头登录云启)，约 30-60 秒后点「刷新」查看新数据" } });
      } catch (error) { writeJson(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) }); }
      return;
    }

    if (pathname === "/api/erp/reports/yunqi-categories") {
      try { writeJson(res, 200, { ok: true, data: require("./services/yunqiCloud.cjs").listCategories() }); }
      catch (error) { writeJson(res, 500, { ok: false, error: error?.message || String(error) }); }
      return;
    }

    if (pathname === "/api/warehouse/workbench") {
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        workbench: await getWarehouseWorkbench({ ...payload, user: session.user }),
      });
      return;
    }

    if (pathname === "/api/warehouse/action") {
      await handleWarehouseActionRequest({
        req,
        res,
        session,
        performWarehouseAction,
      });
      return;
    }

    if (pathname === "/api/qc/workbench") {
      writeJson(res, 200, {
        ok: true,
        workbench: await getQcWorkbench({ user: session.user }),
      });
      return;
    }

    if (pathname === "/api/qc/action") {
      await handleQcActionRequest({
        req,
        res,
        session,
        performQcAction,
      });
      return;
    }

    if (pathname === "/api/outbound/workbench") {
      writeJson(res, 200, {
        ok: true,
        workbench: await getOutboundWorkbench({ user: session.user }),
      });
      return;
    }

    if (pathname === "/api/outbound/action") {
      await handleOutboundActionRequest({
        req,
        res,
        session,
        performOutboundAction,
      });
      return;
    }

    if (pathname === "/api/inventory/action") {
      await handleInventoryActionRequest({
        req,
        res,
        session,
        performInventoryAction,
      });
      return;
    }

    if (pathname === "/api/consign-after-sale/action") {
      await handleConsignAfterSaleActionRequest({
        req,
        res,
        session,
        confirmConsignAfterSaleReceipt,
        listConsignAfterSaleReceipts,
      });
      return;
    }

    if (pathname === "/api/work-items/list") {
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        items: await listWorkItems(payload, session.user),
      });
      return;
    }

    if (pathname === "/api/work-items/stats") {
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        stats: await getWorkItemStats(payload, session.user),
      });
      return;
    }

    if (pathname === "/api/work-items/generate") {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        result: await generateWorkItems(payload, session.user),
      });
      return;
    }

    if (pathname === "/api/work-items/update-status") {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        item: await updateWorkItemStatus(payload, session.user),
      });
      return;
    }

    if (pathname === "/") {
      writeHtml(res, renderShell({
        title: "Temu ERP 局域网入口",
        subtitle: "采购、仓库和 QC 网页工作台的本地服务已经启动。",
        cards: buildLandingCards(),
        currentPath: "/",
        user: session.user,
      }));
      return;
    }

    if (pathname === "/users") {
      const users = await listUsers({ limit: 200 });
      writeHtml(res, renderShell({
        title: "用户管理",
        subtitle: "管理员在这里创建真实账号、分配角色、重设访问码，并实时同步给已登录用户。",
        cards: [
          {
            title: "实时同步",
            body: "保存用户后会通过 WebSocket 推送到已登录页面；被停用的账号会立即退出网页登录。",
          },
          {
            title: "登录规则",
            body: "用户可使用用户名称或用户 ID 登录。新建用户必须设置访问码，编辑用户时访问码留空表示不修改。",
          },
        ],
        currentPath: pathname,
        user: session.user,
        content: renderUserManagement(users, session.user),
      }));
      return;
    }

    if (pathname === "/1688") {
      const status = await get1688AuthStatus(session.user);
      let purchaseAccounts = [];
      try {
        const result = list1688PurchaseAccounts(session.user?.companyId);
        purchaseAccounts = Array.isArray(result?.accounts) ? result.accounts : [];
      } catch {
        purchaseAccounts = [];
      }
      writeHtml(res, renderShell({
        title: "1688 授权",
      subtitle: "绑定 1688 开放平台应用和买家账号；同一公司可以保存多个 1688 采购账号供推单时选择。",
        cards: [],
        currentPath: pathname,
        user: session.user,
        content: render1688AuthPage(status, getRequestOrigin(req), purchaseAccounts),
      }));
      return;
    }

    if (pathname === "/purchase") {
      const model = await getPurchaseWorkbench({ user: session.user });
      writeHtml(res, renderShell({
        title: "采购工作台",
        subtitle: "采购接收运营 PR，跟踪采购单，并把待财务处理的付款事项集中到一个入口。",
        cards: buildPurchaseSummaryCards(model),
        currentPath: pathname,
        user: session.user,
        content: renderPurchaseWorkbench(model, session.user),
      }));
      return;
    }

    if (pathname === "/warehouse") {
      const model = await getWarehouseWorkbench({ user: session.user });
      writeHtml(res, renderShell({
        title: "仓库工作台",
        subtitle: "仓管在这里处理待到货、确认到仓和核数。",
        cards: buildWarehouseSummaryCards(model),
        currentPath: pathname,
        user: session.user,
        content: renderWarehouseWorkbench(model, session.user),
      }));
      return;
    }

    if (pathname === "/qc") {
      const model = await getQcWorkbench({ user: session.user });
      writeHtml(res, renderShell({
        title: "QC 工作台",
        subtitle: "运营录入抽检数和不良数，系统按不良率自动判定并释放或锁定库存。",
        cards: buildQcSummaryCards(model),
        currentPath: pathname,
        user: session.user,
        content: renderQcWorkbench(model, session.user),
      }));
      return;
    }

    if (pathname === "/outbound") {
      const model = await getOutboundWorkbench({ user: session.user });
      writeHtml(res, renderShell({
        title: "出库 / 发货工作台",
        subtitle: "运营创建出库计划，仓库拣货、打包并确认发出，最后由运营确认出库完成。",
        cards: buildOutboundSummaryCards(model),
        currentPath: pathname,
        user: session.user,
        content: renderOutboundWorkbench(model, session.user),
      }));
      return;
    }

    writeJson(res, 404, {
      ok: false,
      error: "Not found",
      path: pathname,
    });
}

// 多店报表预热：服务端定时强制刷新报表缓存，让 page cache 常暖、用户请求秒回（冷查询只发生在后台）。
let _msrPrewarmTimer = null;
function startMultiStoreReportPrewarm(db) {
  if (!db || _msrPrewarmTimer) return;
  let svc;
  try { svc = require("./services/multiStoreReport.cjs"); } catch { return; }
  if (typeof svc.prewarmMultiStoreReport !== "function") return;
  const run = () => { try { svc.prewarmMultiStoreReport(db, attachTemuCloudDbIfPossible); } catch {} };
  setTimeout(run, 8000); // 启动 8s 后预热一次（错开启动期 IO）
  _msrPrewarmTimer = setInterval(run, 4 * 60 * 1000); // 每 4 分钟保持暖（< 5min 缓存 TTL）
  if (_msrPrewarmTimer && typeof _msrPrewarmTimer.unref === "function") _msrPrewarmTimer.unref();
}

function startLanServer(options = {}) {
  if (lanState.server) {
    return Promise.resolve(getLanStatus());
  }

  lanState.sessionStore = options.sessionStore || null;
  const port = Number.isInteger(Number(options.port)) && Number(options.port) >= 0
    ? Number(options.port)
    : DEFAULT_LAN_PORT;
  const bindAddress = options.bindAddress || DEFAULT_BIND_ADDRESS;
  const handler = createRequestHandler(options);
  const server = http.createServer(handler);
  server.on("upgrade", handleWebSocketUpgrade);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.removeAllListeners("error");
      server.removeAllListeners("listening");
    };

    server.once("error", (error) => {
      cleanup();
      lanState.lastError = error.message || String(error);
      reject(error);
    });

    server.once("listening", () => {
      cleanup();
      const address = server.address();
      lanState.server = server;
      lanState.port = address && typeof address === "object" ? Number(address.port) : port;
      lanState.bindAddress = bindAddress;
      lanState.startedAt = new Date().toISOString();
      lanState.lastError = null;
      resolve(getLanStatus());
      try { startMultiStoreReportPrewarm(options.db); } catch {}
    });

    server.listen(port, bindAddress);
  });
}

function stopLanServer() {
  if (!lanState.server) {
    return Promise.resolve(getLanStatus({
      running: false,
      startedAt: null,
    }));
  }

  const server = lanState.server;
  for (const client of Array.from(lanState.wsClients)) {
    try { client.socket.destroy(); } catch {}
  }
  lanState.wsClients.clear();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        lanState.lastError = error.message || String(error);
        reject(error);
        return;
      }
      lanState.server = null;
      lanState.startedAt = null;
      resolve(getLanStatus());
    });
  });
}

module.exports = {
  DEFAULT_BIND_ADDRESS,
  DEFAULT_LAN_PORT,
  createRequestHandler,
  getLanAddresses,
  getLanStatus,
  broadcastLanEvent,
  syncLanUserSessions,
  startLanServer,
  stopLanServer,
  runConsignDeliveriesUnified,
  attachTemuCloudDbIfPossible,
  // 导出给 scripts/rebuild-consign-snapshot.cjs 复用，保证物化快照与在线查询同一份 SQL（不漂移）。
  UNIFIED_CONSIGN_CTE,
  buildUnifiedConsignCte,
  unifiedRowToPayload,
  prewarmPurchaseWorkbench,
};
