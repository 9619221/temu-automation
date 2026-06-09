// ============================================================
// Service Worker 入口
// ============================================================
// MV3 SW 会被 Chrome 回收，所有持久状态走 chrome.storage.local 或 IndexedDB
// 周期任务用 chrome.alarms（setInterval 不可靠）
// ============================================================

import {
  URL_WHITELIST,
  URL_BLACKLIST,
  URL_DISCOVERY_ALLOWLIST,
  DISCOVERY_MAX_BODY_CHARS,
  EVENT_NAME,
  BYPASS_SYMBOL_KEY,
} from "./hook-config.js";
import { enqueue, queueDepth, flush } from "./ingest-queue.js";

const ALARM_FLUSH = "temu-monitor.flush";
const ALARM_COLLECT = "temu-monitor.collect";
const ALARM_ENROLL = "temu-monitor.enroll"; // 轮询云端待报名任务
const ALARM_SALES_TREND = "temu-monitor.sales-trend";
const ALARM_REVIEW = "temu-monitor.review";
const ALARM_HPF = "temu-monitor.hpf";
const STATS_KEY = "temu_monitor_stats";
const MALLS_KEY = "temu_monitor_malls";
const COLLECTOR_STATE_KEY = "temu_monitor_collector_state";
const COLLECTOR_WINDOW_KEY = "temu_monitor_collector_window";
const COLLECTOR_QUERY = "__temu_monitor_collector=1";
const COLLECTOR_BOOT_VERSION_KEY = "temu_monitor_collector_boot_version";
const COLLECTOR_BOOT_VERSION = "20260601_return_pages";
const COLLECTOR_ALARM_MINUTES = 2;
const COLLECTOR_BATCH_SIZE = 4;
const COLLECTOR_WINDOW_WIDTH = 360;
const COLLECTOR_WINDOW_HEIGHT = 300;
const HK_CLOUD_ENDPOINT = "https://erp.temu.chat/cloud";
const ACTIVITY_LIBRARY_ENDPOINT = "/api/kiana/gamblers/marketing/enroll/list";
const ACTIVITY_LIBRARY_STATE_KEY = "temu_monitor_activity_library_state";
const ACTIVITY_LIBRARY_BATCH_SIZE = 50;
const ACTIVITY_LIBRARY_TARGET_LIMIT = 200;
const ACTIVITY_LIBRARY_MAX_BATCHES_PER_RUN = 8;
const ACTIVITY_LIBRARY_RUN_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVITY_LIBRARY_SEEN_TTL_MS = 6 * 60 * 60 * 1000;
// 活动报名决策数据:主动采 enroll/activity/list(拿 thematicId) + scroll/match(拿参考价/三级ID/目标库存),
// 喂 cloud parser 落 temu_activity_snapshot(补全 activity_id/suggested_price)。实测 match 免 anti-content。
const ACTIVITY_MATCH_LIST_ENDPOINT = "/api/kiana/gamblers/marketing/enroll/activity/list";
const ACTIVITY_MATCH_ENDPOINT = "/api/kiana/gamblers/marketing/enroll/scroll/match";
const ACTIVITY_MATCH_STATE_KEY = "temu_monitor_activity_match_state";
const ACTIVITY_MATCH_RUN_INTERVAL_MS = 30 * 60 * 1000; // 整轮间隔
const ACTIVITY_MATCH_MAX_THEMATICS = 30; // 每轮最多 match 的活动数(限速)
const ACTIVITY_MATCH_ROWCOUNT = 10; // 实测 >10 被拒
const ACTIVITY_MATCH_MAX_SCROLL = 10; // 每活动最多翻页
// 已报名活动记录:同 /enroll/list 但不带 sessionStatusTag/productSkcIds(=已报名记录);按当前店翻页扫全
const ENROLL_RECORD_STATE_KEY = "temu_monitor_enroll_record_state";
const ENROLL_RECORD_RUN_INTERVAL_MS = 30 * 60 * 1000; // 30min/轮
const ENROLL_RECORD_PAGE_SIZE = 50;
const ENROLL_RECORD_MAX_PAGES = 60; // 1498/50≈30页,留余量
// 活动场次(scroll/match,补活动ID)多店自动采集:遍历云端 targets 各店,每轮采 N 个店、cursor 轮换覆盖全部
const ACTIVITY_MATCH_TARGETS_STATE_KEY = "temu_monitor_activity_match_targets_state";
const ACTIVITY_MATCH_MALLS_PER_RUN = 4; // 每轮采几个店(轮换),35店约9轮转完
// 已报名活动记录多店主动采集:遍历云端 targets 各店(轮换),每店翻页采全量 /enroll/list
const ENROLL_RECORD_TARGETS_STATE_KEY = "temu_monitor_enroll_record_targets_state";
const ENROLL_RECORD_TARGETS_RUN_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2h/轮
const ENROLL_RECORD_TARGETS_MALLS_PER_RUN = 4; // 每轮 4 店,35店约9轮转完
// JIT(全托管建议关闭) + VMI(普通备货单) 主动调度：替代桌面端 worker.mjs urgentOrders Playwright 任务。
// 云端 /v1/jit-vmi-targets 给本租户近 30 天活跃 mall，SW 对每个 mall 调两个 venom 接口。
const JIT_VMI_STATE_KEY = "temu_monitor_jit_vmi_state";
const JIT_VMI_TARGET_LIMIT = 50;
const JIT_VMI_MAX_CALLS_PER_RUN = 16;
const JIT_VMI_RUN_INTERVAL_MS = 30 * 60 * 1000;
const JIT_VMI_PROBES = [
  {
    kind: "fetch-active-jit-suggest-close",
    path: "/mms/venom/api/supplier/sales/management/querySuggestCloseJitSkc",
    body: { pageNo: 1, pageSize: 100 },
  },
  {
    kind: "fetch-active-vmi-suborder",
    path: "/mms/venom/api/supplier/purchase/manager/querySubOrderList",
    body: { pageNo: 1, pageSize: 100 },
  },
];
// 流量分析主动直采：SW 对"当前登录店"直接 fetch flow/analysis/goods/list（实测不需 anti-content，
// 但 mallid 必须=当前登录店，跨店 403）。多店覆盖靠多开（每实例一店）。parser parseProductFlowGoods 自动落 temu_product_flow_snapshot。
const SALES_TREND_STATE_KEY = "temu_monitor_sales_trend_state";
const SALES_TREND_TARGET_LIMIT = 1200;
const SALES_TREND_PER_GROUP_LIMIT = 100;
const SALES_TREND_MAX_MALLS_PER_RUN = 12;
const SALES_TREND_BATCH_SIZE = 50;
const SALES_TREND_RUN_INTERVAL_MS = 60 * 60 * 1000;
// 评价主动采集（review/pageQuery）：SW 后台定时按店翻页采，带 mallid 头 + body {page,pageSize}，无需 anti-content（2026-06-05 实测确认）。
const REVIEW_STATE_KEY = "temu_monitor_review_state";
const REVIEW_TARGET_LIMIT = 100;        // 一次最多取多少店
const REVIEW_MAX_MALLS_PER_RUN = 8;     // 单轮最多采几个店（控时长/风控）
const REVIEW_MAX_PAGES_PER_MALL = 5;    // 每店最多翻几页（评价按时间倒序，覆盖近期）
const REVIEW_PAGE_SIZE = 50;            // 每页条数
const REVIEW_RUN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 每 6 小时一轮
// 高价限流主动采集（high/price/flow/reduce/queryFullHighPriceFlowReduceList）：SW 后台定时按店翻页采被限流商品清单，
// 带 mallid 头（仿评价/品质，无需 anti-content）。请求体先按 {pageNum,pageSize} 试，上线后用真实抓包校准。
const HPF_STATE_KEY = "temu_monitor_hpf_state";
const HPF_TARGET_LIMIT = 100;        // 一次最多取多少店
const HPF_MAX_MALLS_PER_RUN = 8;     // 单轮最多采几个店（控时长/风控）
const HPF_MAX_PAGES_PER_MALL = 6;    // 每店最多翻几页
const HPF_PAGE_SIZE = 50;            // 每页条数
const HPF_PAGE_DELAY_MS = 450;       // 翻页间隔（避 429）
const HPF_RUN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 每 6 小时一轮
// 结算收入概览（income-summary）主动采集：SW 后台定时按店调 /api/merchant/front/finance/income-summary，
// 带 mallid 头，POST 空 body，返回日度收入列表。数据 enqueue 到 cloud.capture_events（url_path 与
// 被动 hook 一致），ERP 端 syncSettlementIncomeFromCapture 自动解析入库 erp_temu_settlement_income。
// 接口在 agentseller 域名，不需要 anti-content。
const ALARM_INCOME_SUMMARY = "temu-monitor.income-summary";
const INCOME_SUMMARY_STATE_KEY = "temu_monitor_income_summary_state";
const INCOME_SUMMARY_RUN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 每 4 小时一轮
const INCOME_SUMMARY_PATH = "/api/merchant/front/finance/income-summary";
// 结算明细三态（待处理/结算中/已到账）主动采集：SW 后台定时按店调 3 端点，带 mallid 头。
// 与 income-summary（被动 hook 采概览页）互补：income-summary 只有日度收入合计，
// 三态明细拆到销售回款/冲回/补贴维度。接口在 agentseller 域名，不需要 anti-content。
const ALARM_SETTLEMENT = "temu-monitor.settlement";
const SETTLEMENT_STATE_KEY = "temu_monitor_settlement_state";
const SETTLEMENT_RUN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 每 4 小时一轮
const SETTLEMENT_ENDPOINTS = [
  { path: "/api/merchant/settle/detail/full/wait-settlement", status: "wait_settlement" },
  { path: "/api/merchant/settle/detail/full/in-settlement", status: "in_settlement" },
  { path: "/api/merchant/settle/detail/full/settled", status: "settled" },
];
// 对账中心账务明细（fund/detail/pageSearch）主动采集：SW 后台定时按店翻页采，带 mallid 头。
// 接口原属 kuajingmaihuo 域名（需 anti-content），但 agentseller 域名也暴露相同路径且不验签名（2026-06-08 实测确认）。
// 数据经 cloud.capture_events 中转 → ERP syncFundDetailFromCapture 自动解析入库 erp_temu_fund_detail。
const ALARM_FUND_DETAIL = "temu-monitor.fund-detail";
const FUND_DETAIL_STATE_KEY = "temu_monitor_fund_detail_state";
const FUND_DETAIL_RUN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 每 4 小时一轮
const FUND_DETAIL_MAX_PAGES = 10; // 每店最多翻 10 页（每页 50 条 = 最多 500 条）
const FUND_DETAIL_PAGE_SIZE = 50;
const FUND_DETAIL_PAGE_DELAY_MS = 600; // 翻页间隔（避 429）
// 价格/改价主动采集：SW 后台定时按店翻页采申报价调整(price-adjust/page-query)+建议价(suggestedPrice/pageQuery)，
// 带 mallid 头（仿高价限流，无需 anti-content）。数据 enqueue→cloud parsePriceAdjust/parseSuggestedPrice 落 skc_snapshots。
const ALARM_PRICE = "temu-monitor.price";
const PRICE_STATE_KEY = "temu_monitor_price_state";
const PRICE_RUN_INTERVAL_MS = 4 * 60 * 60 * 1000;
const PRICE_MAX_MALLS_PER_RUN = 8;
const PRICE_MAX_PAGES = 10;
const PRICE_PAGE_SIZE = 50;
const PRICE_PAGE_DELAY_MS = 500;
// 合规巡查主动采集：SW 后台定时按店翻页采 retrieval/board/pageQuery（违规命中 SKC），
// 带 mallid 头。数据 enqueue→cloud parseComplianceBoard 回填 skc_snapshots.compliance_status。
const ALARM_COMPLIANCE = "temu-monitor.compliance";
const COMPLIANCE_STATE_KEY = "temu_monitor_compliance_state";
const COMPLIANCE_RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const COMPLIANCE_MAX_MALLS_PER_RUN = 8;
const COMPLIANCE_MAX_PAGES = 10;
const COMPLIANCE_PAGE_SIZE = 50;
const COMPLIANCE_PAGE_DELAY_MS = 500;
const FLOW_STATE_KEY = "temu_monitor_flow_state";
const FLOW_RUN_INTERVAL_MS = 30 * 60 * 1000; // 每店每 30 分钟一轮（避 429）
const FLOW_PAGE_SIZE = 100;
const FLOW_MAX_PAGES = 12;
const FLOW_PAGE_DELAY_MS = 500;
// 商品品质看板主动直采：对当前登录店调 goods/quality/supplyChain/qualityMetrics/pageQuery（带 mallid 头，无需 anti-content）。
// 品质数据量小、变化慢，间隔放宽到每店每 6 小时一轮。多店覆盖靠多开（每实例一店）。
const QUALITY_STATE_KEY = "temu_monitor_quality_state";
// 品质看板采集的区域域名(同店各区域 mall_id 一致,一个 mallId 采全部)。method:
//   sw   = SW 后台直接 fetch(该域名接口不验 anti-content,如全球主站)
//   page = 在该域名页面 page world 发请求(页面自动带 anti-content,SW 造不出)由 hook 拦截抓;没开该域名页则后台开品质看板页采完关
// 美区品质分析无数据,不列。
const QUALITY_SITES = [
  { site: "cn", origin: "https://agentseller.temu.com", method: "sw" },
  { site: "eu", origin: "https://agentseller-eu.temu.com", method: "page" },
];
const QUALITY_RUN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 每店每 6 小时一轮
const QUALITY_PAGE_SIZE = 50;
const QUALITY_MAX_PAGES = 10; // 50×10=500 商品/店，足够覆盖
const QUALITY_PAGE_DELAY_MS = 500;
// 商品列表 page world 主动采集（需 anti-content）：在已打开的 agentseller tab 的 MAIN world 调
// /visage-agent-seller/product/skc/pageQuery，页面 Temu wrap 自动注入 anti-content 签名，
// hook.js TrackedFetch 拦截 → enqueue → cloud。依赖至少一个已打开的 agentseller tab。
const PRODUCTS_STATE_KEY = "temu_monitor_products_state";
const PRODUCTS_RUN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 每 4 小时一轮
const PRODUCTS_PAGE_SIZE = 50;
const PRODUCTS_MAX_PAGES = 30;  // 50×30 = 1500 SKC/店
const PRODUCTS_PAGE_DELAY_MS = 600;
// 售后信息 page world 主动采集（需 anti-content）：同商品列表，调 /mms/api/appalachian/afs/queryPageV3。
const AFTERSALES_STATE_KEY = "temu_monitor_aftersales_state";
const AFTERSALES_RUN_INTERVAL_MS = 4 * 60 * 60 * 1000;
const AFTERSALES_PAGE_SIZE = 50;
const AFTERSALES_MAX_PAGES = 20; // 50×20 = 1000 条/店
const AFTERSALES_PAGE_DELAY_MS = 600;
const FEISHU_SUPPLIER_TABLE_URL = "https://mcn24onb5t1o.feishu.cn/base/RLy7bndc4aCXhtsx4yAcr2d8nSg?table=tbl0UhZRpR0niDSt&view=vew5Spjz7c";
const FEISHU_SUPPLIER_ONCE_KEY = "temu_monitor_feishu_supplier_once";

const COLLECTOR_TARGETS = [
  { key: "products", url: "https://agentseller.temu.com/goods/list" },
  { key: "sales", url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/main" },
  { key: "orders", url: "https://agentseller.temu.com/stock/fully-mgt/order-manage" },
  { key: "urgent_orders", url: "https://agentseller.temu.com/stock/fully-mgt/order-manage-urgency" },
  { key: "stock_orders", url: "https://seller.kuajingmaihuo.com/stock/fully-mgt/order-manage" },
  { key: "shipping_desk", url: "https://seller.kuajingmaihuo.com/main/order-manager/shipping-desk" },
  { key: "shipping_list", url: "https://seller.kuajingmaihuo.com/main/order-manager/shipping-list" },
  { key: "traffic_goods", url: "https://agentseller.temu.com/main/flux-analysis-full" },
  { key: "traffic_mall", url: "https://agentseller.temu.com/main/mall-flux-analysis-full" },
  { key: "flow_price", url: "https://agentseller.temu.com/newon/compete-manager" },
  { key: "activity_data", url: "https://agentseller.temu.com/main/act/data-full" },
  { key: "marketing_activity", url: "https://agentseller.temu.com/activity/marketing-activity" },
  { key: "chance_goods", url: "https://agentseller.temu.com/activity/marketing-activity/chance-goods" },
  { key: "bidding", url: "https://agentseller.temu.com/newon/invite-bids/list" },
  { key: "price_adjust", url: "https://agentseller.temu.com/main/adjust-price-manage/order-price" },
  { key: "high_price", url: "https://agentseller.temu.com/main/adjust-price-manage/high-price" },
  { key: "inbound_exception", url: "https://agentseller.temu.com/scp/purchase/board/supplier/exception" },
  { key: "after_sales", url: "https://agentseller.temu.com/main/aftersales/information" },
  { key: "sales_return", url: "https://agentseller.temu.com/activity/sales-return" },
  { key: "soldout", url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/board/sku-sale-out" },
  { key: "receive_abnormal", url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/board/receive-abnormal" },
  { key: "delivery_assessment", url: "https://agentseller.temu.com/wms/deliver-examine-board" },
  { key: "quality_dashboard", url: "https://agentseller.temu.com/main/quality/dashboard" },
  { key: "goods_checkup", url: "https://agentseller.temu.com/goods/checkup-center" },
  { key: "product_select", url: "https://agentseller.temu.com/newon/product-select" },
];

ensureRuntimeDefaults().catch((e) => console.warn("[sw] bootstrap skipped:", e?.message || e));

// ---------- 启动期初始化 ----------
chrome.runtime.onInstalled.addListener(async () => {
  await ensureRuntimeDefaults();
  // reload/更新扩展时清品质采集节流(last_success_at),让新版立即采一次;SW 唤醒走 onStartup 不清,保留每店 6h 节流
  try { const qs = (await getStorage([QUALITY_STATE_KEY]))[QUALITY_STATE_KEY] || {}; await setStorage({ [QUALITY_STATE_KEY]: { ...qs, last_success_at: 0 } }); } catch {}
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureRuntimeDefaults();
});

async function ensureRuntimeDefaults() {
  chrome.alarms.create(ALARM_FLUSH, { periodInMinutes: 0.5 });
  chrome.alarms.create(ALARM_ENROLL, { periodInMinutes: 1 });
  chrome.alarms.create(ALARM_SALES_TREND, { periodInMinutes: Math.max(1, SALES_TREND_RUN_INTERVAL_MS / 60000) });
  chrome.alarms.create(ALARM_REVIEW, { periodInMinutes: Math.max(1, REVIEW_RUN_INTERVAL_MS / 60000) });
  chrome.alarms.create(ALARM_HPF, { periodInMinutes: Math.max(1, HPF_RUN_INTERVAL_MS / 60000) });
  chrome.alarms.create(ALARM_INCOME_SUMMARY, { periodInMinutes: Math.max(1, INCOME_SUMMARY_RUN_INTERVAL_MS / 60000) });
  chrome.alarms.create(ALARM_SETTLEMENT, { periodInMinutes: Math.max(1, SETTLEMENT_RUN_INTERVAL_MS / 60000) });
  chrome.alarms.create(ALARM_FUND_DETAIL, { periodInMinutes: Math.max(1, FUND_DETAIL_RUN_INTERVAL_MS / 60000) });
  chrome.alarms.create(ALARM_PRICE, { periodInMinutes: Math.max(1, PRICE_RUN_INTERVAL_MS / 60000) });
  chrome.alarms.create(ALARM_COMPLIANCE, { periodInMinutes: Math.max(1, COMPLIANCE_RUN_INTERVAL_MS / 60000) });
  await clearAlarm(ALARM_COLLECT);
  const cur = await getStorage(["device_id", COLLECTOR_STATE_KEY, COLLECTOR_WINDOW_KEY, COLLECTOR_BOOT_VERSION_KEY, SALES_TREND_STATE_KEY, REVIEW_STATE_KEY, HPF_STATE_KEY, INCOME_SUMMARY_STATE_KEY, SETTLEMENT_STATE_KEY, FUND_DETAIL_STATE_KEY]);
  const patch = {};
  if (!cur.device_id) patch.device_id = crypto.randomUUID();
  if (!cur[SALES_TREND_STATE_KEY]) {
    patch[SALES_TREND_STATE_KEY] = {
      enabled: false,
      updated_at: Date.now(),
      reason: "disabled_by_default",
    };
  }
  if (!cur[REVIEW_STATE_KEY]) {
    // 评价后台主动采集默认开启（用户明确要求自动化）。参数温和（每6h、每轮8店、每店5页、400ms间隔）以控风控。
    patch[REVIEW_STATE_KEY] = {
      enabled: true,
      updated_at: Date.now(),
      reason: "enabled_for_review_automation",
    };
  }
  if (!cur[HPF_STATE_KEY]) {
    // 高价限流后台主动采集默认开启。参数温和（每6h、每轮8店、每店6页、450ms间隔）以控风控。
    patch[HPF_STATE_KEY] = {
      enabled: true,
      updated_at: Date.now(),
      reason: "enabled_for_hpf_automation",
    };
  }
  if (!cur[INCOME_SUMMARY_STATE_KEY]) {
    // 结算收入概览（income-summary）主动采集默认开启。每 4h 一轮，按店 POST 拉日度收入列表，600ms 间隔。
    patch[INCOME_SUMMARY_STATE_KEY] = {
      enabled: true,
      updated_at: Date.now(),
      reason: "enabled_for_income_summary_automation",
    };
  }
  if (!cur[SETTLEMENT_STATE_KEY]) {
    // 结算明细三态主动采集默认开启。每 4h 一轮，每个 mall 调 3 端点（wait/in/settled），请求间隔 600ms。
    patch[SETTLEMENT_STATE_KEY] = {
      enabled: true,
      updated_at: Date.now(),
      reason: "enabled_for_settlement_automation",
    };
  }
  if (!cur[FUND_DETAIL_STATE_KEY]) {
    // 对账中心账务明细主动采集默认开启。每 4h 一轮，每店翻页采近 30 天资金流水，600ms 间隔。
    patch[FUND_DETAIL_STATE_KEY] = {
      enabled: true,
      updated_at: Date.now(),
      reason: "enabled_for_fund_detail_automation",
    };
  }
  if (!cur[COLLECTOR_STATE_KEY]) {
    patch[COLLECTOR_STATE_KEY] = {
      enabled: false,
      index: 0,
      updated_at: Date.now(),
      reason: "passive_capture_only",
    };
    patch[COLLECTOR_WINDOW_KEY] = null;
    patch[COLLECTOR_BOOT_VERSION_KEY] = COLLECTOR_BOOT_VERSION;
  } else if (cur[COLLECTOR_BOOT_VERSION_KEY] !== COLLECTOR_BOOT_VERSION) {
    patch[COLLECTOR_STATE_KEY] = {
      ...cur[COLLECTOR_STATE_KEY],
      enabled: false,
      updated_at: Date.now(),
      reason: "passive_capture_only",
    };
    patch[COLLECTOR_WINDOW_KEY] = null;
    patch[COLLECTOR_BOOT_VERSION_KEY] = COLLECTOR_BOOT_VERSION;
  }
  if (Object.keys(patch).length) await setStorage(patch);
  await tryAutoConfigure();
  if (cur[COLLECTOR_WINDOW_KEY]) {
    try { await chrome.windows.remove(cur[COLLECTOR_WINDOW_KEY]); } catch {}
  }
  await cleanupStrayCollectorTabs(null).catch((e) => console.warn("[sw] collector cleanup err", e?.message || e));
  await disableFeishuSupplierAutoImport("bootstrap").catch((e) => console.warn("[sw] feishu auto disable err", e?.message || e));
}

// Keep the extension on the HK cloud endpoint; old local/custom endpoints are replaced on startup.
async function tryAutoConfigure() {
  const cur = await getStorage(["cloud_endpoint", "auth_token"]);
  if (cur.cloud_endpoint === HK_CLOUD_ENDPOINT && cur.auth_token) return;
  const defaultEndpoint = HK_CLOUD_ENDPOINT;
  try {
    const resp = await fetch(defaultEndpoint + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "cjl20020421" }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data?.token) return;
    await setStorage({ cloud_endpoint: defaultEndpoint, auth_token: data.token });
    console.log(`[sw] auto-configured to ${defaultEndpoint}`);
  } catch (e) {
    console.warn("[sw] auto-configure skipped:", e?.message || e);
  }
}

// ---------- 周期上报 ----------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_COLLECT) {
    await clearAlarm(ALARM_COLLECT);
    await cleanupStrayCollectorTabs(null).catch((e) => console.warn("[sw] collector cleanup err", e?.message || e));
    return;
  }
  if (alarm.name === ALARM_ENROLL) {
    await pollEnrollTasks().catch((e) => console.warn("[sw] enroll poll err", e?.message || e));
    return;
  }
  if (alarm.name === ALARM_SALES_TREND) {
    collectSalesTrendFromTargets().catch((e) => console.warn("[sw] sales trend collect err", e?.message || e));
    return;
  }
  if (alarm.name === ALARM_REVIEW) {
    collectReviewsFromTargets().catch((e) => console.warn("[sw] review collect err", e?.message || e));
    return;
  }
  if (alarm.name === ALARM_HPF) {
    collectHighPriceFlowFromTargets().catch((e) => console.warn("[sw] hpf collect err", e?.message || e));
    return;
  }
  if (alarm.name === ALARM_INCOME_SUMMARY) {
    collectIncomeSummaryFromTargets().catch((e) => console.warn("[sw] income-summary collect err", e?.message || e));
    return;
  }
  if (alarm.name === ALARM_SETTLEMENT) {
    collectSettlementFromTargets().catch((e) => console.warn("[sw] settlement collect err", e?.message || e));
    return;
  }
  if (alarm.name === ALARM_FUND_DETAIL) {
    collectFundDetailFromTargets().catch((e) => console.warn("[sw] fund-detail collect err", e?.message || e));
    return;
  }
  if (alarm.name === ALARM_PRICE) {
    collectPriceFromTargets().catch((e) => console.warn("[sw] price collect err", e?.message || e));
    return;
  }
  if (alarm.name === ALARM_COMPLIANCE) {
    collectComplianceFromTargets().catch((e) => console.warn("[sw] compliance collect err", e?.message || e));
    return;
  }
  if (alarm.name !== ALARM_FLUSH) return;
  // 未配置兜底：onInstalled 阶段 fetch 偶尔失败（network stack 没准备好），
  // 这里 30s 一次重试，配置成功后立即心跳上来
  const cfgNow = await getStorage(["cloud_endpoint", "auth_token"]);
  if (!cfgNow.cloud_endpoint || !cfgNow.auth_token) {
    await tryAutoConfigure();
  }
  const result = await flush();
  await bumpStats({
    last_flush_at: Date.now(),
    last_flush_result: result,
    last_flush_sent: (result.sent || 0),
  });
  // 顺便心跳到 cloud 做远程诊断
  sendHeartbeat().catch((e) => console.warn("[sw] heartbeat err", e));
  collectActivityLibraryFromTargets().catch((e) => console.warn("[sw] activity library collect err", e?.message || e));
  collectActivityMatchForCurrentMall().catch((e) => console.warn("[sw] activity match collect err", e?.message || e));
  collectActivityMatchFromTargets().catch((e) => console.warn("[sw] activity match targets collect err", e?.message || e));
  collectEnrollRecords().catch((e) => console.warn("[sw] enroll record collect err", e?.message || e));
  collectEnrollRecordsFromTargets().catch((e) => console.warn("[sw] enroll record targets collect err", e?.message || e));
  collectJitVmiFromTargets().catch((e) => console.warn("[sw] jit/vmi collect err", e?.message || e));
  collectFlowForCurrentMall().catch((e) => console.warn("[sw] flow collect err", e?.message || e));
  collectQualityAllSites().catch((e) => console.warn("[sw] quality collect err", e?.message || e));
  collectProductsAndAfterSalesViaPage().catch((e) => console.warn("[sw] products/aftersales page-world collect err", e?.message || e));
});

// 在任意 Temu tab 上抓 page world stats（供心跳用）
async function probePageStats() {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        "https://agentseller.temu.com/*",
        "https://agentseller-eu.temu.com/*",
        "https://agentseller-us.temu.com/*",
        "https://seller.kuajingmaihuo.com/*",
      ],
    });
    if (!tabs.length) return null;
    const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    return await new Promise((resolve) => {
      let settled = false;
      try {
        chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_STATS" }, (resp) => {
          if (settled) return;
          settled = true;
          if (chrome.runtime.lastError) return resolve(null);
          resolve(resp ? { ...resp, tabId: tab.id, tabUrl: tab.url } : null);
        });
      } catch {
        settled = true;
        resolve(null);
      }
      setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 2500);
    });
  } catch {
    return null;
  }
}

const RELOAD_VERSION_KEY = "last_reload_version";
const RECONFIG_VERSION_KEY = "last_reconfig_version";

async function sendHeartbeat() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", "device_id", STATS_KEY, COLLECTOR_STATE_KEY, RELOAD_VERSION_KEY, RECONFIG_VERSION_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return;
  const stats = cfg[STATS_KEY] || {};
  const collector = cfg[COLLECTOR_STATE_KEY] || {};
  const depth = await queueDepth();
  const probe = await probePageStats();
  const payload = {
    captured_count: stats.captured_count || 0,
    total_sent: stats.total_sent || 0,
    queue_depth: depth,
    last_capture_url: probe?.stats?.lastCaptureUrl || null,
    last_capture_at: probe?.stats?.lastCaptureAt || stats.last_capture_at || null,
    last_flush_at: stats.last_flush_at || null,
    last_flush_ok: stats.last_flush_result ? (stats.last_flush_result.ok ? 1 : 0) : null,
    last_flush_reason: stats.last_flush_result?.reason || null,
    hook_xhr_alive: probe?.healthy ? 1 : (probe ? 0 : null),
    hook_perf_seen: probe?.stats?.perfSeen || 0,
    page_url: probe?.pageUrl || null,
    collector_enabled: collector.enabled === false ? 0 : 1,
    collector_index: Number.isFinite(Number(collector.index)) ? Number(collector.index) : null,
    collector_last_target_key: collector.last_target_key || null,
    collector_last_target_url: collector.last_target_url || null,
    collector_last_targets: Array.isArray(collector.last_targets) ? collector.last_targets : [],
    collector_updated_at: Number(collector.updated_at) || null,
    last_reload_version: cfg[RELOAD_VERSION_KEY] || 0,
    last_reconfig_version: cfg[RECONFIG_VERSION_KEY] || 0,
    ts: Date.now(),
  };
  try {
    const resp = await fetch(cfg.cloud_endpoint.replace(/\/$/, "") + "/api/ingest/v1/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.auth_token}`,
        "X-Device-Id": cfg.device_id || "",
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return;
    const json = await resp.json().catch(() => null);
    if (!json) return;

    // 1. 处理 reconfig：cloud 让我们改 cloud_endpoint / auth_token（不需要 reload，下次心跳走新 cloud）
    if (json.reconfig && json.reconfig_version > (cfg[RECONFIG_VERSION_KEY] || 0)) {
      const newCfg = {};
      if (json.reconfig.cloud_endpoint) newCfg.cloud_endpoint = HK_CLOUD_ENDPOINT;
      if (json.reconfig.auth_token) newCfg.auth_token = json.reconfig.auth_token;
      newCfg[RECONFIG_VERSION_KEY] = json.reconfig_version;
      await setStorage(newCfg);
      console.log("[sw] cloud reconfigured to " + HK_CLOUD_ENDPOINT + " version=" + json.reconfig_version);
    }

    // 2. 处理 reload
    if (json.needs_reload && json.reload_version > (cfg[RELOAD_VERSION_KEY] || 0)) {
      await setStorage({ [RELOAD_VERSION_KEY]: json.reload_version });
      console.log("[sw] cloud requested reload, version=" + json.reload_version);
      try { chrome.runtime.reload(); } catch (e) { console.warn("[sw] reload failed", e); }
    }
    await disableFeishuSupplierAutoImport("heartbeat").catch((e) => console.warn("[sw] feishu auto disable err", e?.message || e));
  } catch {}
}

// ---------- 处理 content script 上行 ----------
function activityLibraryOriginForSite(site) {
  const value = String(site || "").toLowerCase();
  if (value.includes("agentseller-us")) return "https://agentseller-us.temu.com";
  if (value.includes("agentseller-eu")) return "https://agentseller-eu.temu.com";
  if (value.includes("kuajingmaihuo") || value === "seller") return "https://seller.kuajingmaihuo.com";
  return "https://agentseller.temu.com";
}

function normalizeActivitySkcIds(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value == null ? "" : value).trim();
    if (!/^\d{5,}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function pruneActivitySeen(seen, now) {
  const next = {};
  const source = seen && typeof seen === "object" ? seen : {};
  for (const [key, value] of Object.entries(source)) {
    const ts = Number(value || 0);
    if (ts && now - ts < ACTIVITY_LIBRARY_SEEN_TTL_MS) next[key] = ts;
  }
  return next;
}

async function collectActivityLibraryFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", ACTIVITY_LIBRARY_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[ACTIVITY_LIBRARY_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < ACTIVITY_LIBRARY_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  const seen = pruneActivitySeen(state.seen, now);
  await setStorage({
    [ACTIVITY_LIBRARY_STATE_KEY]: {
      ...state,
      seen,
      last_run_at: now,
    },
  });

  const targetUrl = `${cfg.cloud_endpoint.replace(/\/$/, "")}/api/ingest/v1/activity-targets?limit=${ACTIVITY_LIBRARY_TARGET_LIMIT}`;
  const targetResp = await fetch(targetUrl, {
    headers: { Authorization: `Bearer ${cfg.auth_token}` },
  });
  if (!targetResp.ok) return { ok: false, reason: `targets_http_${targetResp.status}` };
  const targetData = await targetResp.json().catch(() => null);
  const targets = Array.isArray(targetData?.targets) ? targetData.targets : [];
  let batchCount = 0;
  let enqueuedCount = 0;
  for (const target of targets) {
    const mallId = String(target?.mall_id || target?.mallId || "").trim();
    if (!mallId) continue;
    const ids = normalizeActivitySkcIds(target?.skc_ids || target?.skcIds);
    if (!ids.length) continue;
    const origin = activityLibraryOriginForSite(target?.site);
    const url = `${origin}${ACTIVITY_LIBRARY_ENDPOINT}`;
    for (let start = 0; start < ids.length; start += ACTIVITY_LIBRARY_BATCH_SIZE) {
      if (batchCount >= ACTIVITY_LIBRARY_MAX_BATCHES_PER_RUN) break;
      const batch = ids.slice(start, start + ACTIVITY_LIBRARY_BATCH_SIZE);
      const seenKey = `${origin}|${mallId}|${batch.join(",")}`;
      if (seen[seenKey] && now - Number(seen[seenKey]) < ACTIVITY_LIBRARY_SEEN_TTL_MS) continue;
      const requestBody = JSON.stringify({
        pageNo: 1,
        pageSize: 50,
        productSkcIds: batch,
        sessionStatusTag: 4,
      });
      batchCount++;
      try {
        const resp = await fetch(url, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            mallid: mallId,
          },
          body: requestBody,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (resp.ok && body && typeof body === "object") {
          await enqueue({
            kind: "fetch-active-activity-library",
            url,
            method: "POST",
            status: resp.status,
            ts: Date.now(),
            site: target?.site || "agentseller",
            page: "background/activity-library",
            mall_id: mallId,
            body,
            bodyText: text.length > 200000 ? null : text,
            requestBodyText: requestBody,
            bodySize: text.length,
            activeSource: "marketing_enroll_list_background",
            activeSkcCount: batch.length,
          });
          await bumpStats({ captured_count_delta: 1 });
          enqueuedCount++;
        }
        seen[seenKey] = Date.now();
      } catch {
        delete seen[seenKey];
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (batchCount >= ACTIVITY_LIBRARY_MAX_BATCHES_PER_RUN) break;
  }
  await setStorage({
    [ACTIVITY_LIBRARY_STATE_KEY]: {
      ...state,
      seen: pruneActivitySeen(seen, Date.now()),
      last_run_at: now,
      last_success_at: Date.now(),
      last_batch_count: batchCount,
      last_enqueued_count: enqueuedCount,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, batchCount, enqueuedCount };
}

// ---------- 流量分析主动直采（采当前登录店，铺开 temu_product_flow_snapshot） ----------
// 用 scripting 在 agentseller 标签页取当前 mallid（manifest 无 cookies 权限，借 scripting）
async function getCurrentAgentSellerMall() {
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://agentseller.temu.com/*", "https://agentseller-us.temu.com/*", "https://agentseller-eu.temu.com/*"],
    });
    if (!tabs.length) return null;
    const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (document.cookie.match(/mallid=([^;]+)/i)?.[1] || ""),
    });
    const mallId = String(res?.result || "").trim();
    if (!mallId) return null;
    let origin = "https://agentseller.temu.com";
    try { origin = new URL(tab.url).origin; } catch {}
    return { mallId, origin };
  } catch {
    return null;
  }
}

// 拿所有打开的各站点 agentseller tab（CN / 美 -us / 欧 -eu），每个站点一个 {mallId, origin}。
// 供「需分站点采集」的任务（如品质看板）：同一店各站点品质分/评分不同，需各站点用各自登录态分别采。
async function getAllAgentSellerMalls() {
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://agentseller.temu.com/*", "https://agentseller-us.temu.com/*", "https://agentseller-eu.temu.com/*"],
    });
    const byOrigin = new Map();
    for (const tab of tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))) {
      let origin = "";
      try { origin = new URL(tab.url).origin; } catch { continue; }
      if (byOrigin.has(origin)) continue; // 每站点取最近访问的一个 tab
      let mallId = "";
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => (document.cookie.match(/mallid=([^;]+)/i)?.[1] || ""),
        });
        mallId = String(res?.result || "").trim();
      } catch { continue; }
      if (mallId) byOrigin.set(origin, { mallId, origin });
    }
    return Array.from(byOrigin.values());
  } catch {
    return [];
  }
}

// origin → 站点标记（cn/us/eu），用于品质数据按站点区分。
function qualitySiteTag(origin) {
  if (/agentseller-us\./i.test(origin)) return "us";
  if (/agentseller-eu\./i.test(origin)) return "eu";
  return "cn";
}

// 轮询云端待报名任务,按当前店分发到登录态 agentseller tab(page world 发 submit),结果回传云端
async function pollEnrollTasks() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token"]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return;
  const cur = await getCurrentAgentSellerMall();
  if (!cur) return; // 没有登录态 agentseller tab,跳过
  const base = cfg.cloud_endpoint.replace(/\/$/, "");
  let tasks = [];
  try {
    const resp = await fetch(`${base}/api/ingest/v1/enroll-tasks?mall_id=${encodeURIComponent(cur.mallId)}`, {
      headers: { Authorization: `Bearer ${cfg.auth_token}` },
    });
    if (!resp.ok) return;
    const data = await resp.json();
    tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  } catch { return; }
  if (!tasks.length) return;
  const tabs = await chrome.tabs.query({
    url: ["https://agentseller.temu.com/*", "https://agentseller-us.temu.com/*", "https://agentseller-eu.temu.com/*"],
  });
  const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (!tab) return;
  for (const task of tasks) {
    const body = {
      activityType: task.activity_type,
      activityThematicId: Number(task.activity_thematic_id),
      productList: task.product_list,
    };
    const result = await new Promise((resolve) => {
      let done = false;
      try {
        chrome.tabs.sendMessage(tab.id, { type: "ENROLL_SUBMIT", task: { body } }, (resp) => {
          if (done) return; done = true;
          if (chrome.runtime.lastError) { resolve({ ok: false, error: String(chrome.runtime.lastError.message || "") }); return; }
          resolve(resp || { ok: false, error: "no_resp" });
        });
      } catch (e) { resolve({ ok: false, error: String(e?.message || e) }); }
      setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: "sw_dispatch_timeout" }); } }, 35000);
    });
    try {
      await fetch(`${base}/api/ingest/v1/enroll-tasks/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.auth_token}` },
        body: JSON.stringify({ task_id: task.task_id, status: result.ok ? "done" : "failed", result }),
      });
    } catch { /* 下轮重试由云端 status 控制 */ }
  }
}

// 采当前店的活动报名决策数据:activity/list 展平 thematic → 逐个 scroll/match → enqueue 上云
async function collectActivityMatchForCurrentMall() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", ACTIVITY_MATCH_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[ACTIVITY_MATCH_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < ACTIVITY_MATCH_RUN_INTERVAL_MS) return { ok: true, skipped: "interval" };
  const cur = await getCurrentAgentSellerMall();
  if (!cur) return { ok: false, reason: "no_agentseller_tab_or_mallid" };
  await setStorage({ [ACTIVITY_MATCH_STATE_KEY]: { ...state, last_run_at: now } });
  const site = cur.origin.includes("-us") ? "agentseller-us" : cur.origin.includes("-eu") ? "agentseller-eu" : "agentseller";

  // 1. 活动列表 → 展平 thematicList
  let types = [];
  try {
    const lr = await fetch(`${cur.origin}${ACTIVITY_MATCH_LIST_ENDPOINT}`, {
      method: "POST", credentials: "include", cache: "no-store",
      headers: { "Content-Type": "application/json", mallid: cur.mallId },
      body: JSON.stringify({ pageNum: 1, pageSize: 50 }),
    });
    const j = safeParseJson(await lr.text());
    types = j?.result?.activityList || j?.result?.list || [];
  } catch { return { ok: false, reason: "list_failed" }; }
  const thematics = [];
  for (const t of types) {
    for (const th of (t.thematicList || [])) if (th?.activityThematicId) thematics.push({ type: t.activityType, tid: th.activityThematicId });
  }
  const cap = thematics.slice(0, ACTIVITY_MATCH_MAX_THEMATICS);

  // 2. 逐 thematic scroll/match(翻页),enqueue 上云(带 requestBodyText 让 parser 从 __request 拿 activityThematicId/type)
  let enqueued = 0;
  for (const th of cap) {
    let ctx = null, rounds = 0;
    while (rounds < ACTIVITY_MATCH_MAX_SCROLL) {
      const reqBody = JSON.stringify({ activityThematicId: th.tid, activityType: th.type, productIds: [], productSkcExtCodes: [], rowCount: ACTIVITY_MATCH_ROWCOUNT, ...(ctx ? { searchScrollContext: ctx } : {}) });
      let body = null, text = "";
      try {
        const resp = await fetch(`${cur.origin}${ACTIVITY_MATCH_ENDPOINT}`, {
          method: "POST", credentials: "include", cache: "no-store",
          headers: { "Content-Type": "application/json", mallid: cur.mallId },
          body: reqBody,
        });
        text = await resp.text();
        body = safeParseJson(text);
        if (!resp.ok || !body || typeof body !== "object") break;
      } catch { break; }
      await enqueue({
        kind: "fetch-activity-match", url: `${cur.origin}${ACTIVITY_MATCH_ENDPOINT}`,
        method: "POST", status: 200, ts: Date.now(), site,
        page: "background/activity-match", mall_id: cur.mallId,
        body, bodyText: text.length > 200000 ? null : text, requestBodyText: reqBody, bodySize: text.length,
        activeSource: "scroll_match_background",
      });
      enqueued++;
      await bumpStats({ captured_count_delta: 1 });
      const res = body.result || {};
      ctx = res.searchScrollContext || null; rounds++;
      if (!res.hasMore || !(res.matchList || []).length) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await setStorage({ [ACTIVITY_MATCH_STATE_KEY]: { ...state, last_run_at: now, last_success_at: Date.now(), last_thematics: cap.length, last_enqueued: enqueued } });
  return { ok: true, thematics: cap.length, enqueued };
}

// 多店自动采集活动场次:遍历云端 targets 各店(用 mallid 头切店,跟活动库采集同机制),每轮采 N 个店、cursor 轮换覆盖全部。
// 补全各店活动ID(scroll/match),不依赖用户手动逛各店后台。
async function collectActivityMatchFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", ACTIVITY_MATCH_TARGETS_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[ACTIVITY_MATCH_TARGETS_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < ACTIVITY_MATCH_RUN_INTERVAL_MS) return { ok: true, skipped: "interval" };
  let malls = [];
  try {
    const tr = await fetch(`${cfg.cloud_endpoint.replace(/\/$/, "")}/api/ingest/v1/activity-targets?limit=${ACTIVITY_LIBRARY_TARGET_LIMIT}`, { headers: { Authorization: `Bearer ${cfg.auth_token}` } });
    if (!tr.ok) return { ok: false, reason: `targets_http_${tr.status}` };
    const td = await tr.json().catch(() => null);
    const seen = new Set();
    for (const t of (Array.isArray(td?.targets) ? td.targets : [])) {
      const mid = String(t?.mall_id || t?.mallId || "").trim();
      if (!mid || seen.has(mid)) continue;
      seen.add(mid);
      malls.push({ mallId: mid, site: t?.site || "agentseller" });
    }
  } catch { return { ok: false, reason: "targets_failed" }; }
  if (!malls.length) return { ok: true, reason: "no_malls" };
  const start = Number(state.cursor || 0) % malls.length;
  const slice = [];
  for (let i = 0; i < ACTIVITY_MATCH_MALLS_PER_RUN && i < malls.length; i++) slice.push(malls[(start + i) % malls.length]);
  await setStorage({ [ACTIVITY_MATCH_TARGETS_STATE_KEY]: { ...state, last_run_at: now, cursor: (start + ACTIVITY_MATCH_MALLS_PER_RUN) % malls.length, total_malls: malls.length } });
  let enqueued = 0;
  for (const m of slice) {
    const origin = activityLibraryOriginForSite(m.site);
    let types = [];
    try {
      const lr = await fetch(`${origin}${ACTIVITY_MATCH_LIST_ENDPOINT}`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json", mallid: m.mallId }, body: JSON.stringify({ pageNum: 1, pageSize: 50 }) });
      const j = safeParseJson(await lr.text());
      types = j?.result?.activityList || j?.result?.list || [];
    } catch { continue; }
    const thematics = [];
    for (const t of types) for (const th of (t.thematicList || [])) if (th?.activityThematicId) thematics.push({ type: t.activityType, tid: th.activityThematicId });
    const cap = thematics.slice(0, ACTIVITY_MATCH_MAX_THEMATICS);
    for (const th of cap) {
      let ctx = null, rounds = 0;
      while (rounds < ACTIVITY_MATCH_MAX_SCROLL) {
        const reqBody = JSON.stringify({ activityThematicId: th.tid, activityType: th.type, productIds: [], productSkcExtCodes: [], rowCount: ACTIVITY_MATCH_ROWCOUNT, ...(ctx ? { searchScrollContext: ctx } : {}) });
        let body = null, text = "";
        try {
          const resp = await fetch(`${origin}${ACTIVITY_MATCH_ENDPOINT}`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json", mallid: m.mallId }, body: reqBody });
          text = await resp.text();
          body = safeParseJson(text);
          if (!resp.ok || !body || typeof body !== "object") break;
        } catch { break; }
        await enqueue({ kind: "fetch-activity-match", url: `${origin}${ACTIVITY_MATCH_ENDPOINT}`, method: "POST", status: 200, ts: Date.now(), site: m.site, page: "background/activity-match-targets", mall_id: m.mallId, body, bodyText: text.length > 200000 ? null : text, requestBodyText: reqBody, bodySize: text.length, activeSource: "scroll_match_targets" });
        enqueued++;
        await bumpStats({ captured_count_delta: 1 });
        const res = body.result || {};
        ctx = res.searchScrollContext || null; rounds++;
        if (!res.hasMore || !(res.matchList || []).length) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await setStorage({ [ACTIVITY_MATCH_TARGETS_STATE_KEY]: { ...state, last_run_at: now, last_success_at: Date.now(), cursor: (start + ACTIVITY_MATCH_MALLS_PER_RUN) % malls.length, total_malls: malls.length, last_malls: slice.length, last_enqueued: enqueued } });
  return { ok: true, malls: slice.length, enqueued };
}

// 已报名活动记录:按当前店翻页调 /enroll/list(不带 sessionStatusTag/productSkcIds=已报名),enqueue 上云。
// cloud parser 据 list 项的 enrollId 自动分流到 temu_activity_enroll_record(不混可报快照)。
async function collectEnrollRecords() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", ENROLL_RECORD_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[ENROLL_RECORD_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < ENROLL_RECORD_RUN_INTERVAL_MS) return { ok: true, skipped: "interval" };
  const cur = await getCurrentAgentSellerMall();
  if (!cur) return { ok: false, reason: "no_agentseller_tab_or_mallid" };
  await setStorage({ [ENROLL_RECORD_STATE_KEY]: { ...state, last_run_at: now } });
  const site = cur.origin.includes("-us") ? "agentseller-us" : cur.origin.includes("-eu") ? "agentseller-eu" : "agentseller";
  const url = `${cur.origin}${ACTIVITY_LIBRARY_ENDPOINT}`; // /enroll/list
  let enqueued = 0;
  for (let page = 1; page <= ENROLL_RECORD_MAX_PAGES; page++) {
    const reqBody = JSON.stringify({ pageNo: page, pageSize: ENROLL_RECORD_PAGE_SIZE });
    let body = null, text = "";
    try {
      const resp = await fetch(url, {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json", mallid: cur.mallId },
        body: reqBody,
      });
      text = await resp.text();
      body = safeParseJson(text);
      if (!resp.ok || !body || typeof body !== "object") break;
    } catch { break; }
    const list = body?.result?.list || [];
    if (!list.length) break;
    await enqueue({
      kind: "fetch-enroll-record", url,
      method: "POST", status: 200, ts: Date.now(), site,
      page: "background/enroll-record", mall_id: cur.mallId,
      body, bodyText: text.length > 200000 ? null : text, requestBodyText: reqBody, bodySize: text.length,
      activeSource: "marketing_enroll_record_background",
    });
    enqueued++;
    await bumpStats({ captured_count_delta: 1 });
    const total = Number(body?.result?.total || 0);
    if (page * ENROLL_RECORD_PAGE_SIZE >= total) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await setStorage({ [ENROLL_RECORD_STATE_KEY]: { ...state, last_run_at: now, last_success_at: Date.now(), last_enqueued: enqueued } });
  return { ok: true, enqueued };
}

// 多店版:遍历云端 targets 各店,每店翻页采全量 /enroll/list(含 signSessionList/sites/活动库存),
// enqueue 上云后由 parser 落 temu_activity_enroll_record。每 2h 一轮,4 店/轮,cursor 轮换覆盖全部。
async function collectEnrollRecordsFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", ENROLL_RECORD_TARGETS_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[ENROLL_RECORD_TARGETS_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < ENROLL_RECORD_TARGETS_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  let malls = [];
  try {
    const tr = await fetch(`${cfg.cloud_endpoint.replace(/\/$/, "")}/api/ingest/v1/activity-targets?limit=${ACTIVITY_LIBRARY_TARGET_LIMIT}`, {
      headers: { Authorization: `Bearer ${cfg.auth_token}` },
    });
    if (!tr.ok) return { ok: false, reason: `targets_http_${tr.status}` };
    const td = await tr.json().catch(() => null);
    const seen = new Set();
    for (const t of (Array.isArray(td?.targets) ? td.targets : [])) {
      const mid = String(t?.mall_id || t?.mallId || "").trim();
      if (!mid || seen.has(mid)) continue;
      seen.add(mid);
      malls.push({ mallId: mid, site: t?.site || "agentseller" });
    }
  } catch { return { ok: false, reason: "targets_failed" }; }
  if (!malls.length) return { ok: true, reason: "no_malls" };
  const start = Number(state.cursor || 0) % malls.length;
  const slice = [];
  for (let i = 0; i < ENROLL_RECORD_TARGETS_MALLS_PER_RUN && i < malls.length; i++) {
    slice.push(malls[(start + i) % malls.length]);
  }
  await setStorage({ [ENROLL_RECORD_TARGETS_STATE_KEY]: { ...state, last_run_at: now, cursor: (start + ENROLL_RECORD_TARGETS_MALLS_PER_RUN) % malls.length, total_malls: malls.length } });
  let enqueued = 0;
  for (const m of slice) {
    const origin = activityLibraryOriginForSite(m.site);
    const url = `${origin}${ACTIVITY_LIBRARY_ENDPOINT}`;
    for (let page = 1; page <= ENROLL_RECORD_MAX_PAGES; page++) {
      const reqBody = JSON.stringify({ pageNo: page, pageSize: ENROLL_RECORD_PAGE_SIZE });
      let body = null, text = "";
      try {
        const resp = await fetch(url, {
          method: "POST", credentials: "include", cache: "no-store",
          headers: { "Content-Type": "application/json", mallid: m.mallId },
          body: reqBody,
        });
        text = await resp.text();
        body = safeParseJson(text);
        if (!resp.ok || !body || typeof body !== "object") break;
      } catch { break; }
      const list = body?.result?.list || [];
      if (!list.length) break;
      await enqueue({
        kind: "fetch-enroll-record", url,
        method: "POST", status: 200, ts: Date.now(), site: m.site,
        page: "background/enroll-record-targets", mall_id: m.mallId,
        body, bodyText: text.length > 200000 ? null : text, requestBodyText: reqBody, bodySize: text.length,
        activeSource: "marketing_enroll_record_targets",
      });
      enqueued++;
      await bumpStats({ captured_count_delta: 1 });
      const total = Number(body?.result?.total || 0);
      if (page * ENROLL_RECORD_PAGE_SIZE >= total) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  await setStorage({ [ENROLL_RECORD_TARGETS_STATE_KEY]: { ...state, last_run_at: now, last_success_at: Date.now(), cursor: (start + ENROLL_RECORD_TARGETS_MALLS_PER_RUN) % malls.length, total_malls: malls.length, last_malls: slice.length, last_enqueued: enqueued } });
  if (enqueued > 0) await flush();
  return { ok: true, malls: slice.length, enqueued };
}

async function collectFlowForCurrentMall() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", FLOW_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[FLOW_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < FLOW_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  const cur = await getCurrentAgentSellerMall();
  if (!cur) return { ok: false, reason: "no_agentseller_tab_or_mallid" };
  await setStorage({ [FLOW_STATE_KEY]: { ...state, last_run_at: now } });

  const url = `${cur.origin}/api/seller/full/flow/analysis/goods/list`;
  let enqueuedCount = 0;
  for (let page = 1; page <= FLOW_MAX_PAGES; page++) {
    const requestBody = JSON.stringify({ pageNum: page, pageSize: FLOW_PAGE_SIZE, dayDimension: 1 });
    try {
      const resp = await fetch(url, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", mallid: cur.mallId },
        body: requestBody,
      });
      const text = await resp.text();
      const body = safeParseJson(text);
      if (!resp.ok || !body || typeof body !== "object") break;
      await enqueue({
        kind: "fetch-active-flow",
        url,
        method: "POST",
        status: resp.status,
        ts: Date.now(),
        site: "agentseller",
        page: "background/flow-analysis",
        mall_id: cur.mallId,
        body,
        bodyText: text.length > 200000 ? null : text,
        requestBodyText: requestBody,
        bodySize: text.length,
        activeSource: "flow_analysis_background",
      });
      await bumpStats({ captured_count_delta: 1 });
      enqueuedCount++;
      const list = body?.result?.list || body?.result?.pageItems || [];
      if (!Array.isArray(list) || list.length < FLOW_PAGE_SIZE) break; // 末页
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, FLOW_PAGE_DELAY_MS));
  }
  await setStorage({
    [FLOW_STATE_KEY]: { ...state, last_run_at: now, last_success_at: Date.now(), last_enqueued: enqueuedCount, last_mall: cur.mallId },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, enqueuedCount, mall: cur.mallId };
}

// 商品品质看板主动直采（自动切区域 + 自动绕 anti-content）：用当前登录店 mallId 按 QUALITY_SITES 各区域采。
// 全球(method=sw):SW 直接 fetch;欧区(method=page):SW 造不出 anti-content,改在 -eu 页面 page world 发请求(页面自动带 anti-content)由 hook 抓。
// 节流按「上次成功」算(采空不计,reload 自动清);品质按档(qualityScoreEnum 1-4)逐档翻页,参数名 page。
async function collectQualityAllSites() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", QUALITY_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[QUALITY_STATE_KEY] || {};
  if (state.last_success_at && now - Number(state.last_success_at) < QUALITY_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  const cur = await getCurrentAgentSellerMall();
  if (!cur || !cur.mallId) return { ok: false, reason: "no_agentseller_tab" };
  const mallId = cur.mallId;

  let enqueuedCount = 0;
  let pageTried = false;
  for (const { site, origin, method } of QUALITY_SITES) {
    if (method === "page") {
      pageTried = true;
      await collectQualityViaPage(origin, mallId); // page world 发,hook 异步抓,不计入 enqueuedCount
    } else {
      enqueuedCount += await fetchQualitySW(origin, site, mallId);
    }
  }
  const patch = { ...state, last_run_at: now, last_enqueued: enqueuedCount, last_sites: QUALITY_SITES.map((s) => s.site) };
  // 全球 SW 采到(>0)或欧区 page 跑过都算本轮成功,记节流(避免每个 flush tick 都重开 -eu 后台页)
  if (enqueuedCount > 0 || pageTried) patch.last_success_at = now;
  await setStorage({ [QUALITY_STATE_KEY]: patch });
  if (enqueuedCount > 0) await flush();
  return { ok: true, enqueuedCount, sites: QUALITY_SITES.length };
}

// SW 直接 fetch 一个站点的品质(各档翻页) → enqueue 上报,返回 enqueue 条数。用于不验 anti-content 的站点(全球)。
async function fetchQualitySW(origin, siteTag, mallId) {
  const url = `${origin}/bg-luna-agent-seller/goods/quality/supplyChain/qualityMetrics/pageQuery`;
  let enq = 0;
  for (const scoreEnum of [1, 2, 3, 4]) {
    for (let pageNo = 1; pageNo <= QUALITY_MAX_PAGES; pageNo++) {
      const requestBody = JSON.stringify({ page: pageNo, pageSize: QUALITY_PAGE_SIZE, qualityScoreEnum: scoreEnum });
      let listLen = 0;
      let total = 0;
      try {
        const resp = await fetch(url, {
          method: "POST", credentials: "include", cache: "no-store",
          headers: { "Content-Type": "application/json", mallid: mallId },
          body: requestBody,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (!resp.ok || !body || typeof body !== "object") break;
        const result = body.result || {};
        const list = result.pageItems || result.list || [];
        listLen = Array.isArray(list) ? list.length : 0;
        total = Number(result.total) || 0;
        if (listLen > 0) {
          await enqueue({
            kind: "fetch-active-quality", url, method: "POST", status: resp.status, ts: Date.now(),
            site: siteTag, page: "background/quality", mall_id: mallId, body,
            bodyText: text.length > 200000 ? null : text, requestBodyText: requestBody,
            bodySize: text.length, activeSource: "quality_background",
          });
          await bumpStats({ captured_count_delta: 1 });
          enq++;
        }
      } catch { break; }
      await new Promise((resolve) => setTimeout(resolve, QUALITY_PAGE_DELAY_MS));
      if (listLen < QUALITY_PAGE_SIZE) break; // 该档末页
      if (total && pageNo * QUALITY_PAGE_SIZE >= total) break;
    }
  }
  return enq;
}

// 在指定站点页面的 page world 发品质请求(页面自动带 anti-content)由 hook 拦截抓 → 上报。用于验 anti-content 的站点(欧区)。
// 优先用已开的该站点 tab;没有则后台开品质看板页,采完关。各档逐档翻页。注:依赖 hook 拦截 page world fetch(已实测抓到)。
async function collectQualityViaPage(origin, mallId) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: origin + "/*" }); } catch {}
  let tab = (tabs || []).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  let opened = false;
  if (!tab) {
    try {
      tab = await chrome.tabs.create({ url: origin + "/main/quality/dashboard", active: false });
      opened = true;
      await new Promise((r) => setTimeout(r, 9000)); // 等页面加载 + hook 注入
    } catch { return; }
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [mallId, QUALITY_PAGE_SIZE, QUALITY_MAX_PAGES],
      func: async (mid, pageSize, maxPages) => {
        const s = (ms) => new Promise((r) => setTimeout(r, ms));
        for (const e of [1, 2, 3, 4]) {
          for (let p = 1; p <= maxPages; p++) {
            let n = 0;
            try {
              const r = await fetch("/bg-luna-agent-seller/goods/quality/supplyChain/qualityMetrics/pageQuery", {
                method: "POST", credentials: "include", cache: "no-store",
                headers: { "Content-Type": "application/json", mallid: mid },
                body: JSON.stringify({ page: p, pageSize, qualityScoreEnum: e }),
              });
              const j = await r.json();
              n = ((j && j.result && (j.result.pageItems || j.result.list)) || []).length;
            } catch { break; }
            await s(400);
            if (n < pageSize) break;
          }
        }
      },
    });
  } catch (e) { console.warn("[sw] quality page-world err", e?.message || e); }
  await new Promise((r) => setTimeout(r, 4000)); // 等 hook 抓 + flush
  if (opened) { try { await chrome.tabs.remove(tab.id); } catch {} }
}

// ---------- JIT/VMI 主动调度（替代桌面端 urgentOrders Playwright 任务） ----------
async function collectJitVmiFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", JIT_VMI_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[JIT_VMI_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < JIT_VMI_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  await setStorage({
    [JIT_VMI_STATE_KEY]: {
      ...state,
      last_run_at: now,
    },
  });

  const targetUrl = `${cfg.cloud_endpoint.replace(/\/$/, "")}/api/ingest/v1/jit-vmi-targets?limit=${JIT_VMI_TARGET_LIMIT}`;
  let targets = [];
  try {
    const resp = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${cfg.auth_token}` },
    });
    if (!resp.ok) return { ok: false, reason: `targets_http_${resp.status}` };
    const data = await resp.json().catch(() => null);
    targets = Array.isArray(data?.targets) ? data.targets : [];
  } catch (error) {
    return { ok: false, reason: `targets_err_${String(error?.message || error).slice(0, 40)}` };
  }

  let callCount = 0;
  let enqueuedCount = 0;
  let errorCount = 0;
  for (const target of targets) {
    if (callCount >= JIT_VMI_MAX_CALLS_PER_RUN) break;
    const mallId = String(target?.mall_id || target?.mallId || "").trim();
    if (!mallId) continue;
    const origin = activityLibraryOriginForSite(target?.site);
    for (const probe of JIT_VMI_PROBES) {
      if (callCount >= JIT_VMI_MAX_CALLS_PER_RUN) break;
      callCount++;
      const url = `${origin}${probe.path}`;
      const requestBody = JSON.stringify(probe.body);
      try {
        const resp = await fetch(url, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            mallid: mallId,
          },
          body: requestBody,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (resp.ok && body && typeof body === "object") {
          await enqueue({
            kind: probe.kind,
            url,
            method: "POST",
            status: resp.status,
            ts: Date.now(),
            site: target?.site || "agentseller",
            page: "background/jit-vmi",
            mall_id: mallId,
            mall_name: target?.mall_name || null,
            body,
            bodyText: text.length > 200000 ? null : text,
            requestBodyText: requestBody,
            bodySize: text.length,
            activeSource: "jit_vmi_background",
          });
          await bumpStats({ captured_count_delta: 1 });
          enqueuedCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  await setStorage({
    [JIT_VMI_STATE_KEY]: {
      ...state,
      last_run_at: now,
      last_success_at: Date.now(),
      last_call_count: callCount,
      last_enqueued_count: enqueuedCount,
      last_error_count: errorCount,
      last_target_count: targets.length,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, callCount, enqueuedCount, errorCount, targetCount: targets.length };
}

function normalizeSalesTrendSkuIds(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value == null ? "" : value).trim();
    if (!/^\d{5,}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function createSalesTrendRequestBody(batch) {
  // 请求体已实测确认（2026-06-04 抓包 querySkuSalesNumber）：{ productSkuIds:number[], startDate, endDate }，近 30 天窗口。
  // 注意：前端一次只传 1 个 SKU；批量多个待部署后验证接口是否接受，若被拒就把 SALES_TREND_BATCH_SIZE 调小。
  const fmt = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const end = new Date(Date.now() - 86400000); // endDate 取昨天（当天数据未出全）
  const start = new Date(end.getTime() - 30 * 86400000); // 近 30 天
  return {
    productSkuIds: batch.map((x) => Number(x)).filter((n) => Number.isFinite(n)),
    startDate: fmt(start),
    endDate: fmt(end),
  };
}

async function collectSalesTrendFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", SALES_TREND_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[SALES_TREND_STATE_KEY] || {};
  if (!state.enabled) return { ok: true, skipped: "disabled" };
  if (state.last_run_at && now - Number(state.last_run_at) < SALES_TREND_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  await setStorage({
    [SALES_TREND_STATE_KEY]: {
      ...state,
      last_run_at: now,
    },
  });

  const targetUrl = `${cfg.cloud_endpoint.replace(/\/$/, "")}/api/ingest/v1/sales-trend-targets?limit=${SALES_TREND_TARGET_LIMIT}&per_group_limit=${SALES_TREND_PER_GROUP_LIMIT}`;
  let targets = [];
  try {
    const resp = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${cfg.auth_token}` },
    });
    if (!resp.ok) return { ok: false, reason: `targets_http_${resp.status}` };
    const data = await resp.json().catch(() => null);
    targets = Array.isArray(data?.targets) ? data.targets : [];
  } catch (error) {
    return { ok: false, reason: `targets_err_${String(error?.message || error).slice(0, 40)}` };
  }

  let mallCount = 0;
  let callCount = 0;
  let enqueuedCount = 0;
  let errorCount = 0;
  for (const target of targets) {
    if (mallCount >= SALES_TREND_MAX_MALLS_PER_RUN) break;
    const mallId = String(target?.mall_id || target?.mallId || "").trim();
    if (!mallId) continue;
    const ids = normalizeSalesTrendSkuIds(target?.sku_ids || target?.skuIds);
    if (!ids.length) continue;
    mallCount++;
    const origin = activityLibraryOriginForSite(target?.site);
    const url = `${origin}/mms/venom/api/supplier/sales/management/querySkuSalesNumber`;
    for (let start = 0; start < ids.length; start += SALES_TREND_BATCH_SIZE) {
      const batch = ids.slice(start, start + SALES_TREND_BATCH_SIZE);
      const requestBody = JSON.stringify(createSalesTrendRequestBody(batch));
      callCount++;
      try {
        const resp = await fetch(url, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            mallid: mallId,
          },
          body: requestBody,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (resp.ok && body && typeof body === "object") {
          await enqueue({
            kind: "fetch-active-sales-trend",
            url,
            method: "POST",
            status: resp.status,
            ts: Date.now(),
            site: target?.site || "agentseller",
            page: "background/sales-trend",
            mall_id: mallId,
            body,
            bodyText: text.length > 200000 ? null : text,
            requestBodyText: requestBody,
            bodySize: text.length,
            activeSource: "sales_trend_background",
          });
          await bumpStats({ captured_count_delta: 1 });
          enqueuedCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  await setStorage({
    [SALES_TREND_STATE_KEY]: {
      ...state,
      last_run_at: now,
      last_success_at: Date.now(),
      last_call_count: callCount,
      last_mall_count: mallCount,
      last_enqueued_count: enqueuedCount,
      last_error_count: errorCount,
      last_target_count: targets.length,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, callCount, enqueuedCount, errorCount, mallCount, targetCount: targets.length };
}

function createReviewRequestBody(page, pageSize) {
  // 请求体已实测确认（2026-06-05 agentseller 登录态抓包）：{ page, pageSize }，带 mallid 头，无需 anti-content。
  return { page, pageSize };
}

function createHpfListRequestBody(page, pageSize) {
  // ⚠️ 请求体待实测校准：参考 marvel-mms list 类接口常见 { pageNum, pageSize }。
  // 上线后用一次真实抓包（运营逛高价限流页）确认字段名/是否要 site 等，再改这里。
  return { pageNum: page, pageSize };
}

// 高价限流主动采集：按 cloud /v1/review-targets 给的活跃店列表（通用活跃店表），SW 后台逐店翻页
// fetch high/price/flow/reduce/queryFullHighPriceFlowReduceList（带 mallid 头 + cookie，无需 anti-content）。
// 响应 enqueue→flush→cloud parser(classifyOperationRisk→high_price_flow) 落 temu_operation_risk_snapshot。
async function collectHighPriceFlowFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", HPF_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[HPF_STATE_KEY] || {};
  if (!state.enabled) return { ok: true, skipped: "disabled" };
  if (state.last_run_at && now - Number(state.last_run_at) < HPF_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  await setStorage({ [HPF_STATE_KEY]: { ...state, last_run_at: now } });

  const targetUrl = `${cfg.cloud_endpoint.replace(/\/$/, "")}/api/ingest/v1/review-targets?limit=${HPF_TARGET_LIMIT}`;
  let targets = [];
  try {
    const resp = await fetch(targetUrl, { headers: { Authorization: `Bearer ${cfg.auth_token}` } });
    if (!resp.ok) return { ok: false, reason: `targets_http_${resp.status}` };
    const data = await resp.json().catch(() => null);
    targets = Array.isArray(data?.targets) ? data.targets : [];
  } catch (error) {
    return { ok: false, reason: `targets_err_${String(error?.message || error).slice(0, 40)}` };
  }

  let mallCount = 0;
  let callCount = 0;
  let enqueuedCount = 0;
  let errorCount = 0;
  for (const target of targets) {
    if (mallCount >= HPF_MAX_MALLS_PER_RUN) break;
    const mallId = String(target?.mall_id || target?.mallId || "").trim();
    if (!mallId) continue;
    mallCount++;
    // 高价限流是 agentseller「高价管理」页接口，被动抓包实测 host=agentseller.temu.com、路径含 /us/。
    const url = "https://agentseller.temu.com/marvel-mms/us/api/kiana/direnjie/high/price/flow/reduce/queryFullHighPriceFlowReduceList";
    let total = null;
    for (let page = 1; page <= HPF_MAX_PAGES_PER_MALL; page++) {
      const requestBody = JSON.stringify(createHpfListRequestBody(page, HPF_PAGE_SIZE));
      callCount++;
      let pageItemsLen = 0;
      try {
        const resp = await fetch(url, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", mallid: mallId },
          body: requestBody,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (resp.ok && body && typeof body === "object" && body.success) {
          await enqueue({
            kind: "fetch-active-hpf",
            url,
            method: "POST",
            status: resp.status,
            ts: Date.now(),
            site: target?.site || "agentseller",
            page: "background/high-price-flow",
            mall_id: mallId,
            body,
            bodyText: text.length > 200000 ? null : text,
            requestBodyText: requestBody,
            bodySize: text.length,
            activeSource: "high_price_flow_background",
          });
          await bumpStats({ captured_count_delta: 1 });
          enqueuedCount++;
          const result = body.result || {};
          const list = Array.isArray(result.list) ? result.list
            : Array.isArray(result.pageItems) ? result.pageItems
            : Array.isArray(result.dataList) ? result.dataList
            : Array.isArray(result.items) ? result.items : [];
          if (total == null && Number.isFinite(Number(result.total))) total = Number(result.total);
          pageItemsLen = list.length;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
      await new Promise((resolve) => setTimeout(resolve, HPF_PAGE_DELAY_MS));
      if (pageItemsLen < HPF_PAGE_SIZE) break; // 不足一页 = 最后一页
      if (total != null && page * HPF_PAGE_SIZE >= total) break; // 已覆盖全部
    }
  }

  await setStorage({
    [HPF_STATE_KEY]: {
      ...state,
      last_run_at: now,
      last_success_at: Date.now(),
      last_call_count: callCount,
      last_mall_count: mallCount,
      last_enqueued_count: enqueuedCount,
      last_error_count: errorCount,
      last_target_count: targets.length,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, callCount, enqueuedCount, errorCount, mallCount, targetCount: targets.length };
}

// 评价主动采集：按 cloud /v1/review-targets 给的店列表，SW 后台逐店翻页 fetch review/pageQuery
// （带 mallid 头 + cookie，无需 anti-content）。响应 enqueue→flush→cloud parseTemuReview 落 temu_review_snapshot。
async function collectReviewsFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", REVIEW_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[REVIEW_STATE_KEY] || {};
  if (!state.enabled) return { ok: true, skipped: "disabled" };
  if (state.last_run_at && now - Number(state.last_run_at) < REVIEW_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  await setStorage({ [REVIEW_STATE_KEY]: { ...state, last_run_at: now } });

  // 评价接口 mallid 必须=当前登录店，跨店 403（实测确认）。只采「当前打开的各区域 agentseller tab」
  // 的当前登录店：getAllAgentSellerMalls 每站点(全球/美区/欧区)取最近访问 tab 的当前店 {mallId, origin}。
  // 多区域(全球/美区/欧区)与多店覆盖靠运营开多个区域/店的 tab——单实例自动覆盖当前所有打开的店。
  const malls = await getAllAgentSellerMalls();
  let mallCount = 0;
  let callCount = 0;
  let enqueuedCount = 0;
  let errorCount = 0;
  for (const m of malls) {
    const mallId = String(m?.mallId || "").trim();
    const origin = m?.origin || "https://agentseller.temu.com";
    if (!mallId) continue;
    mallCount++;
    // 区域 site：从 origin 提取 agentseller / agentseller-us / agentseller-eu（与被动抓包 evt.site 口径一致）
    const siteTag = (origin.match(/\/\/(agentseller(?:-us|-eu)?)\./) || [])[1] || "agentseller";
    const url = `${origin}/bg-luna-agent-seller/review/pageQuery`;
    let total = null;
    for (let page = 1; page <= REVIEW_MAX_PAGES_PER_MALL; page++) {
      const requestBody = JSON.stringify(createReviewRequestBody(page, REVIEW_PAGE_SIZE));
      callCount++;
      let pageItemsLen = 0;
      try {
        const resp = await fetch(url, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", mallid: mallId },
          body: requestBody,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (resp.ok && body && typeof body === "object" && body.success) {
          await enqueue({
            kind: "fetch-active-review",
            url,
            method: "POST",
            status: resp.status,
            ts: Date.now(),
            site: siteTag,
            page: "background/review",
            mall_id: mallId,
            body,
            bodyText: text.length > 200000 ? null : text,
            requestBodyText: requestBody,
            bodySize: text.length,
            activeSource: "review_background",
          });
          await bumpStats({ captured_count_delta: 1 });
          enqueuedCount++;
          const result = body.result || {};
          if (total == null && Number.isFinite(Number(result.total))) total = Number(result.total);
          pageItemsLen = Array.isArray(result.pageItems) ? result.pageItems.length : 0;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (pageItemsLen < REVIEW_PAGE_SIZE) break; // 不足一页 = 最后一页
      if (total != null && page * REVIEW_PAGE_SIZE >= total) break; // 已覆盖全部评价
    }
  }

  await setStorage({
    [REVIEW_STATE_KEY]: {
      ...state,
      last_run_at: now,
      last_success_at: Date.now(),
      last_call_count: callCount,
      last_mall_count: mallCount,
      last_enqueued_count: enqueuedCount,
      last_error_count: errorCount,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, callCount, enqueuedCount, errorCount, mallCount };
}

// ===== 结算收入概览（income-summary）主动采集 =====
// 每 4h 一轮，遍历所有 agentseller 店铺，POST /api/merchant/front/finance/income-summary（空 body + mallid 头），
// 返回日度收入列表。enqueue 到 cloud.capture_events（url_path 与被动 hook 一致），
// ERP 端 syncSettlementIncomeFromCapture 自动解析入库 erp_temu_settlement_income，覆盖全部 35 店。
async function collectIncomeSummaryFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", INCOME_SUMMARY_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[INCOME_SUMMARY_STATE_KEY] || {};
  if (!state.enabled) return { ok: true, skipped: "disabled" };
  if (state.last_run_at && now - Number(state.last_run_at) < INCOME_SUMMARY_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  await setStorage({ [INCOME_SUMMARY_STATE_KEY]: { ...state, last_run_at: now } });

  const malls = await getAllAgentSellerMalls();
  let mallCount = 0;
  let enqueuedCount = 0;
  let errorCount = 0;

  for (const m of malls) {
    const mallId = String(m?.mallId || "").trim();
    const origin = m?.origin || "https://agentseller.temu.com";
    if (!mallId) continue;
    mallCount++;
    const siteTag = (origin.match(/\/(agentseller(?:-us|-eu)?)\./) || [])[1] || "agentseller";
    const url = `${origin}${INCOME_SUMMARY_PATH}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", mallid: mallId },
        body: "{}",
      });
      const text = await resp.text();
      const body = safeParseJson(text);
      if (resp.ok && body && typeof body === "object" && body.success !== false) {
        // 检查是否有有效数据（result 应为日度收入数组）
        const list = Array.isArray(body.result) ? body.result : [];
        if (list.length > 0) {
          await enqueue({
            kind: "fetch-active-income-summary",
            url,
            method: "POST",
            status: resp.status,
            ts: Date.now(),
            site: siteTag,
            page: "background/income-summary",
            mall_id: mallId,
            body,
            bodyText: text.length > 200000 ? null : text,
            requestBodyText: "{}",
            bodySize: text.length,
            activeSource: "income_summary_background",
          });
          await bumpStats({ captured_count_delta: 1 });
          enqueuedCount++;
        }
      } else {
        errorCount++;
        console.warn(`[sw] income-summary mall=${mallId} HTTP ${resp.status}`, body?.errorMsg || "");
      }
    } catch (e) {
      errorCount++;
      console.warn(`[sw] income-summary mall=${mallId} err`, e?.message || e);
    }
    // 店铺间间隔 600ms 控风控
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  await setStorage({
    [INCOME_SUMMARY_STATE_KEY]: {
      ...state,
      last_run_at: now,
      last_success_at: Date.now(),
      last_mall_count: mallCount,
      last_enqueued_count: enqueuedCount,
      last_error_count: errorCount,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, enqueuedCount, errorCount, mallCount };
}

// ---------- 结算明细三态主动采集 ----------
// 每 4h 一轮，遍历当前打开的各区域 agentseller tab 的登录店，
// 每店调 3 端点（wait-settlement / in-settlement / settled），
// enqueue 到云端，后端 syncSettlementDetailFromCapture 自动物化。
async function collectSettlementFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", SETTLEMENT_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[SETTLEMENT_STATE_KEY] || {};
  if (!state.enabled) return { ok: true, skipped: "disabled" };
  if (state.last_run_at && now - Number(state.last_run_at) < SETTLEMENT_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  await setStorage({ [SETTLEMENT_STATE_KEY]: { ...state, last_run_at: now } });

  const malls = await getAllAgentSellerMalls();
  let mallCount = 0;
  let callCount = 0;
  let enqueuedCount = 0;
  let errorCount = 0;

  for (const m of malls) {
    const mallId = String(m?.mallId || "").trim();
    const origin = m?.origin || "https://agentseller.temu.com";
    if (!mallId) continue;
    mallCount++;
    const siteTag = (origin.match(/\/(agentseller(?:-us|-eu)?)\./) || [])[1] || "agentseller";

    for (const ep of SETTLEMENT_ENDPOINTS) {
      const url = `${origin}${ep.path}`;
      callCount++;
      // settled 端点必须带 startDate/endDate 否则 Params invalid；默认最近 30 天
      let reqBody = {};
      if (ep.status === "settled") {
        const end = new Date();
        const start = new Date(end.getTime() - 30 * 86400000);
        const fmt = (d) => d.toISOString().slice(0, 10);
        reqBody = { startDate: fmt(start), endDate: fmt(end) };
      }
      const requestBodyText = JSON.stringify(reqBody);
      try {
        const resp = await fetch(url, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", mallid: mallId },
          body: requestBodyText,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (resp.ok && body && typeof body === "object") {
          await enqueue({
            kind: "fetch-active-settlement",
            url,
            method: "POST",
            status: resp.status,
            ts: Date.now(),
            site: siteTag,
            page: "background/settlement",
            mall_id: mallId,
            body,
            bodyText: text.length > 200000 ? null : text,
            requestBodyText,
            bodySize: text.length,
            activeSource: "settlement_background",
          });
          await bumpStats({ captured_count_delta: 1 });
          enqueuedCount++;
        } else {
          errorCount++;
          console.warn(`[sw] settlement ${ep.status} mall=${mallId} HTTP ${resp.status}`);
        }
      } catch (e) {
        errorCount++;
        console.warn(`[sw] settlement ${ep.status} mall=${mallId} err`, e?.message || e);
      }
      // 端点间间隔 600ms 控风控
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  await setStorage({
    [SETTLEMENT_STATE_KEY]: {
      ...state,
      last_run_at: now,
      last_success_at: Date.now(),
      last_call_count: callCount,
      last_mall_count: mallCount,
      last_enqueued_count: enqueuedCount,
      last_error_count: errorCount,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, callCount, enqueuedCount, errorCount, mallCount };
}

// ===== 对账中心账务明细（fund detail）主动采集 =====
// agentseller 域名下 /api/merchant/fund/detail/pageSearch 带 mallid 头翻页采近 30 天流水。
// 数据 enqueue 到 cloud.capture_events（url_path 与被动抓包一致），
// ERP 端 syncFundDetailFromCapture 自动识别并解析入库 erp_temu_fund_detail。
async function collectFundDetailFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", FUND_DETAIL_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[FUND_DETAIL_STATE_KEY] || {};
  if (!state.enabled) return { ok: true, skipped: "disabled" };
  if (state.last_run_at && now - Number(state.last_run_at) < FUND_DETAIL_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  await setStorage({ [FUND_DETAIL_STATE_KEY]: { ...state, last_run_at: now } });

  const malls = await getAllAgentSellerMalls();
  let mallCount = 0, callCount = 0, enqueuedCount = 0, errorCount = 0;

  // 近 30 天日期范围
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 30 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const startStr = fmt(startDate);
  const endStr = fmt(endDate);

  for (const m of malls) {
    const mallId = String(m?.mallId || "").trim();
    const origin = m?.origin || "https://agentseller.temu.com";
    if (!mallId) continue;
    mallCount++;
    const siteTag = (origin.match(/\/(agentseller(?:-us|-eu)?)\./) || [])[1] || "agentseller";
    const url = `${origin}/api/merchant/fund/detail/pageSearch`;
    let total = null;

    for (let page = 1; page <= FUND_DETAIL_MAX_PAGES; page++) {
      const requestBody = JSON.stringify({
        pageNo: page,
        pageSize: FUND_DETAIL_PAGE_SIZE,
        startDate: startStr,
        endDate: endStr,
      });
      callCount++;
      let listLen = 0;
      try {
        const resp = await fetch(url, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", mallid: mallId },
          body: requestBody,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (resp.ok && body && typeof body === "object" && body.success !== false) {
          await enqueue({
            kind: "fetch-active-fund-detail",
            url,
            method: "POST",
            status: resp.status,
            ts: Date.now(),
            site: siteTag,
            page: "background/fund-detail",
            mall_id: mallId,
            body,
            bodyText: text.length > 200000 ? null : text,
            requestBodyText: requestBody,
            bodySize: text.length,
            activeSource: "fund_detail_background",
          });
          await bumpStats({ captured_count_delta: 1 });
          enqueuedCount++;
          const result = body.result || {};
          if (total == null && Number.isFinite(Number(result.total))) total = Number(result.total);
          listLen = Array.isArray(result.resultList) ? result.resultList.length : 0;
        } else {
          errorCount++;
          console.warn(`[sw] fund-detail page=${page} mall=${mallId} HTTP ${resp.status}`, body?.errorMsg || "");
        }
      } catch (e) {
        errorCount++;
        console.warn(`[sw] fund-detail page=${page} mall=${mallId} err`, e?.message || e);
      }
      await new Promise((resolve) => setTimeout(resolve, FUND_DETAIL_PAGE_DELAY_MS));
      if (listLen < FUND_DETAIL_PAGE_SIZE) break; // 不足一页 = 最后一页
      if (total != null && page * FUND_DETAIL_PAGE_SIZE >= total) break;
    }
  }

  await setStorage({
    [FUND_DETAIL_STATE_KEY]: {
      ...state,
      last_run_at: now,
      last_success_at: Date.now(),
      last_call_count: callCount,
      last_mall_count: mallCount,
      last_enqueued_count: enqueuedCount,
      last_error_count: errorCount,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, callCount, enqueuedCount, errorCount, mallCount };
}

// ===== 价格主动采集（申报价调整 + 建议价） =====
async function collectPriceFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", PRICE_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[PRICE_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < PRICE_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  await setStorage({ [PRICE_STATE_KEY]: { ...state, last_run_at: now } });

  const targetUrl = `${cfg.cloud_endpoint.replace(/\/$/, "")}/api/ingest/v1/review-targets?limit=${PRICE_MAX_MALLS_PER_RUN * 2}`;
  let targets = [];
  try {
    const resp = await fetch(targetUrl, { headers: { Authorization: `Bearer ${cfg.auth_token}` } });
    if (!resp.ok) return { ok: false, reason: `targets_http_${resp.status}` };
    const data = await resp.json().catch(() => null);
    targets = Array.isArray(data?.targets) ? data.targets : [];
  } catch (error) {
    return { ok: false, reason: `targets_err_${String(error?.message || error).slice(0, 40)}` };
  }

  let mallCount = 0, callCount = 0, enqueuedCount = 0, errorCount = 0;
  const PROBES = [
    { kind: "fetch-active-price-adjust", path: "/api/kiana/mms/magneto/price-adjust/page-query", pageKey: "pageNumber", sizeKey: "pageSize", label: "price-adjust" },
    { kind: "fetch-active-suggested-price", path: "/visage-agent-seller/product/sku/site/suggestedPrice/pageQuery", pageKey: "pageNo", sizeKey: "pageSize", label: "suggested-price" },
  ];

  for (const target of targets) {
    if (mallCount >= PRICE_MAX_MALLS_PER_RUN) break;
    const mallId = String(target?.mall_id || target?.mallId || "").trim();
    if (!mallId) continue;
    mallCount++;
    const siteTag = target?.site || "agentseller";

    for (const probe of PROBES) {
      const url = `https://agentseller.temu.com${probe.path}`;
      let total = null;
      for (let page = 1; page <= PRICE_MAX_PAGES; page++) {
        const requestBody = JSON.stringify({ [probe.pageKey]: page, [probe.sizeKey]: PRICE_PAGE_SIZE });
        callCount++;
        let listLen = 0;
        try {
          const resp = await fetch(url, {
            method: "POST", credentials: "include", cache: "no-store",
            headers: { "Content-Type": "application/json", mallid: mallId },
            body: requestBody,
          });
          const text = await resp.text();
          const body = safeParseJson(text);
          if (resp.ok && body && typeof body === "object" && body.success !== false) {
            const result = body.result || {};
            const list = result.pageItems || result.list || result.dataList || [];
            listLen = Array.isArray(list) ? list.length : 0;
            if (total == null && Number.isFinite(Number(result.total))) total = Number(result.total);
            if (listLen > 0) {
              await enqueue({
                kind: probe.kind, url, method: "POST", status: resp.status, ts: Date.now(),
                site: siteTag, page: `background/${probe.label}`, mall_id: mallId,
                body, bodyText: text.length > 200000 ? null : text, requestBodyText: requestBody,
                bodySize: text.length, activeSource: `${probe.label}_background`,
              });
              await bumpStats({ captured_count_delta: 1 });
              enqueuedCount++;
            }
          } else { errorCount++; }
        } catch { errorCount++; }
        await new Promise((resolve) => setTimeout(resolve, PRICE_PAGE_DELAY_MS));
        if (listLen < PRICE_PAGE_SIZE) break;
        if (total != null && page * PRICE_PAGE_SIZE >= total) break;
      }
    }
  }

  await setStorage({
    [PRICE_STATE_KEY]: {
      ...state, last_run_at: now, last_success_at: Date.now(),
      last_call_count: callCount, last_mall_count: mallCount,
      last_enqueued_count: enqueuedCount, last_error_count: errorCount,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, callCount, enqueuedCount, errorCount, mallCount };
}

// ===== 合规巡查主动采集（retrieval/board/pageQuery） =====
async function collectComplianceFromTargets() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", COMPLIANCE_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const state = cfg[COMPLIANCE_STATE_KEY] || {};
  if (state.last_run_at && now - Number(state.last_run_at) < COMPLIANCE_RUN_INTERVAL_MS) {
    return { ok: true, skipped: "interval" };
  }
  await setStorage({ [COMPLIANCE_STATE_KEY]: { ...state, last_run_at: now } });

  const targetUrl = `${cfg.cloud_endpoint.replace(/\/$/, "")}/api/ingest/v1/review-targets?limit=${COMPLIANCE_MAX_MALLS_PER_RUN * 2}`;
  let targets = [];
  try {
    const resp = await fetch(targetUrl, { headers: { Authorization: `Bearer ${cfg.auth_token}` } });
    if (!resp.ok) return { ok: false, reason: `targets_http_${resp.status}` };
    const data = await resp.json().catch(() => null);
    targets = Array.isArray(data?.targets) ? data.targets : [];
  } catch (error) {
    return { ok: false, reason: `targets_err_${String(error?.message || error).slice(0, 40)}` };
  }

  let mallCount = 0, callCount = 0, enqueuedCount = 0, errorCount = 0;
  const url = "https://agentseller.temu.com/bg-brando-agent-seller/retrieval/board/pageQuery";

  for (const target of targets) {
    if (mallCount >= COMPLIANCE_MAX_MALLS_PER_RUN) break;
    const mallId = String(target?.mall_id || target?.mallId || "").trim();
    if (!mallId) continue;
    mallCount++;
    let total = null;
    for (let page = 1; page <= COMPLIANCE_MAX_PAGES; page++) {
      const requestBody = JSON.stringify({ pageNo: page, pageSize: COMPLIANCE_PAGE_SIZE });
      callCount++;
      let listLen = 0;
      try {
        const resp = await fetch(url, {
          method: "POST", credentials: "include", cache: "no-store",
          headers: { "Content-Type": "application/json", mallid: mallId },
          body: requestBody,
        });
        const text = await resp.text();
        const body = safeParseJson(text);
        if (resp.ok && body && typeof body === "object" && body.success !== false) {
          const result = body.result || {};
          const list = result.pageItems || result.list || [];
          listLen = Array.isArray(list) ? list.length : 0;
          if (total == null && Number.isFinite(Number(result.total))) total = Number(result.total);
          if (listLen > 0) {
            await enqueue({
              kind: "fetch-active-compliance", url, method: "POST", status: resp.status, ts: Date.now(),
              site: target?.site || "agentseller", page: "background/compliance", mall_id: mallId,
              body, bodyText: text.length > 200000 ? null : text, requestBodyText: requestBody,
              bodySize: text.length, activeSource: "compliance_background",
            });
            await bumpStats({ captured_count_delta: 1 });
            enqueuedCount++;
          }
        } else { errorCount++; }
      } catch { errorCount++; }
      await new Promise((resolve) => setTimeout(resolve, COMPLIANCE_PAGE_DELAY_MS));
      if (listLen < COMPLIANCE_PAGE_SIZE) break;
      if (total != null && page * COMPLIANCE_PAGE_SIZE >= total) break;
    }
  }

  await setStorage({
    [COMPLIANCE_STATE_KEY]: {
      ...state, last_run_at: now, last_success_at: Date.now(),
      last_call_count: callCount, last_mall_count: mallCount,
      last_enqueued_count: enqueuedCount, last_error_count: errorCount,
    },
  });
  if (enqueuedCount > 0) await flush();
  return { ok: true, callCount, enqueuedCount, errorCount, mallCount };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "GET_HOOK_CONFIG") {
    sendResponse({
      URL_WHITELIST,
      URL_BLACKLIST,
      URL_DISCOVERY_ALLOWLIST,
      DISCOVERY_MAX_BODY_CHARS,
      EVENT_NAME,
      BYPASS_SYMBOL_KEY,
    });
    return true;
  }

  if (msg.type === "CAPTURED" && msg.payload) {
    handleCaptured(msg.payload, sender).catch((e) => console.warn("[sw] captured err", e));
    return false; // 不需要响应
  }

  if (msg.type === "QUERY_STATUS") {
    Promise.all([queueDepth(), getStorage([STATS_KEY, "cloud_endpoint", "auth_token", MALLS_KEY, COLLECTOR_STATE_KEY])])
      .then(([depth, cfg]) => {
        sendResponse({
          queueDepth: depth,
          stats: cfg[STATS_KEY] || {},
          malls: cfg[MALLS_KEY] || [],
          collector: cfg[COLLECTOR_STATE_KEY] || { enabled: false },
          configured: !!(cfg.cloud_endpoint && cfg.auth_token),
        });
      })
      .catch(() => sendResponse({ queueDepth: -1, stats: {}, configured: false }));
    return true; // async
  }

  if (msg.type === "FLUSH_NOW") {
    flush()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }

  if (msg.type === "START_COLLECTOR") {
    startCollector()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e?.message || e).slice(0, 200) }));
    return true;
  }

  if (msg.type === "STOP_COLLECTOR") {
    stopCollector()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e?.message || e).slice(0, 200) }));
    return true;
  }

  if (msg.type === "OPEN_FEISHU_SUPPLIER_TABLE") {
    openFeishuSupplierTable()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e?.message || e).slice(0, 200) }));
    return true;
  }

  if (msg.type === "SYNC_FEISHU_SUPPLIERS") {
    syncFeishuSuppliers()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e?.message || e).slice(0, 200) }));
    return true;
  }

  if (msg.type === "FEISHU_SUPPLIERS_CAPTURED" && msg.payload) {
    handleFeishuSuppliersCaptured(msg.payload, sender)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e?.message || e).slice(0, 200) }));
    return true;
  }
});

async function openFeishuSupplierTable() {
  const tabs = await chrome.tabs.query({ url: ["https://*.feishu.cn/base/*"] });
  const matched = tabs.find((tab) => tab?.url && tab.url.includes("/base/RLy7bndc4aCXhtsx4yAcr2d8nSg"));
  if (matched?.id) {
    await chrome.tabs.update(matched.id, { active: true, url: FEISHU_SUPPLIER_TABLE_URL });
    if (matched.windowId) await chrome.windows.update(matched.windowId, { focused: true });
    return { ok: true, opened: false, tabId: matched.id };
  }
  const tab = await chrome.tabs.create({ url: FEISHU_SUPPLIER_TABLE_URL, active: true });
  return { ok: true, opened: true, tabId: tab?.id || null };
}

async function syncFeishuSuppliers() {
  await tryAutoConfigure();
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/feishu\.cn\/base\//i.test(tab.url)) {
    const opened = await openFeishuSupplierTable();
    return { ok: true, opened: true, reason: "已打开飞书表，请登录后再次点击同步", ...opened };
  }
  const response = await sendMessageToTab(tab.id, {
    type: "COLLECT_FEISHU_SUPPLIERS",
    maxSteps: 50,
    delayMs: 300,
  });
  await flush();
  return {
    ok: Boolean(response?.ok),
    rows: response?.rows || 0,
    sourceUrl: response?.sourceUrl || tab.url,
    flushRequested: true,
    reason: response?.reason || null,
  };
}

async function runFeishuSupplierImportOnce(reason = "auto") {
  const cfg = await getStorage([FEISHU_SUPPLIER_ONCE_KEY]);
  const state = cfg[FEISHU_SUPPLIER_ONCE_KEY] || {};
  const now = Date.now();
  if (state.done) return { ok: true, skipped: "done", rows: state.rows || 0 };
  if (state.runningAt && now - Number(state.runningAt) < 180000) {
    return { ok: true, skipped: "running" };
  }
  await setStorage({
    [FEISHU_SUPPLIER_ONCE_KEY]: {
      ...state,
      runningAt: now,
      reason,
      attempts: Number(state.attempts || 0) + 1,
      updatedAt: now,
    },
  });
  try {
    await tryAutoConfigure();
    const tab = await openFeishuSupplierTabForCapture();
    await waitForTabComplete(tab.id, 90000);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await sendMessageToTab(tab.id, {
      type: "COLLECT_FEISHU_SUPPLIERS",
      mode: "api",
      maxSteps: 160,
      delayMs: 250,
    });
    await flush();
    const rows = Number(response?.rows || 0);
    const ok = Boolean(response?.ok && rows > 0);
    await setStorage({
      [FEISHU_SUPPLIER_ONCE_KEY]: {
        done: ok,
        runningAt: 0,
        rows,
        reason,
        error: ok ? null : (response?.reason || "no_rows"),
        updatedAt: Date.now(),
      },
    });
    return { ok, rows, reason: response?.reason || null };
  } catch (error) {
    await setStorage({
      [FEISHU_SUPPLIER_ONCE_KEY]: {
        ...state,
        done: false,
        runningAt: 0,
        error: String(error?.message || error).slice(0, 200),
        updatedAt: Date.now(),
      },
    });
    throw error;
  }
}

async function disableFeishuSupplierAutoImport(reason = "auto_disabled") {
  const cfg = await getStorage([FEISHU_SUPPLIER_ONCE_KEY]);
  const state = cfg[FEISHU_SUPPLIER_ONCE_KEY] || {};
  if (state.auto_disabled) {
    return { ok: true, skipped: "auto_disabled" };
  }
  await setStorage({
    [FEISHU_SUPPLIER_ONCE_KEY]: {
      ...state,
      runningAt: 0,
      auto_disabled: true,
      reason,
      updatedAt: Date.now(),
    },
  });
  return { ok: true, disabled: true };
}

async function openFeishuSupplierTabForCapture() {
  const tabs = await chrome.tabs.query({ url: ["https://*.feishu.cn/base/*"] });
  const matched = tabs.find((tab) => tab?.url && tab.url.includes("/base/RLy7bndc4aCXhtsx4yAcr2d8nSg"));
  if (matched?.id) {
    await chrome.tabs.update(matched.id, { url: FEISHU_SUPPLIER_TABLE_URL, active: false });
    return matched;
  }
  return chrome.tabs.create({ url: FEISHU_SUPPLIER_TABLE_URL, active: false });
}

function waitForTabComplete(tabId, timeoutMs = 60000) {
  return new Promise((resolve) => {
    if (!tabId) return resolve(false);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(false);
    }, timeoutMs);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(true);
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === "complete") finish();
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    if (!tabId) return resolve({ ok: false, reason: "缺少当前标签页" });
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message || "页面脚本未就绪，请刷新飞书页" });
        return;
      }
      resolve(response || { ok: false, reason: "页面没有返回数据" });
    });
  });
}

async function handleFeishuSuppliersCaptured(payload, sender) {
  const enriched = {
    kind: "feishu-supplier-table",
    url: payload.sourceUrl || sender?.tab?.url || FEISHU_SUPPLIER_TABLE_URL,
    method: "EXTENSION",
    status: 200,
    ts: Date.now(),
    site: "feishu",
    page: "/base/RLy7bndc4aCXhtsx4yAcr2d8nSg",
    body: {
      source: "feishu_supplier_table",
      sourceUrl: payload.sourceUrl || sender?.tab?.url || FEISHU_SUPPLIER_TABLE_URL,
      table: payload.table || "tbl0UhZRpR0niDSt",
      view: payload.view || "vew5Spjz7c",
      rows: Array.isArray(payload.rows) ? payload.rows : [],
    },
    tab_id: sender?.tab?.id,
    tab_url: sender?.tab?.url || payload.sourceUrl || "",
    captured_at: Date.now(),
  };
  await enqueue(enriched);
  await bumpStats({ captured_count_delta: 1 });
  return { ok: true, rows: enriched.body.rows.length };
}

async function startCollector() {
  const now = Date.now();
  await clearAlarm(ALARM_COLLECT);
  await cleanupStrayCollectorTabs(null).catch(() => {});
  await setStorage({
    [COLLECTOR_STATE_KEY]: {
      enabled: false,
      index: 0,
      last_started_at: now,
      last_step_at: 0,
      last_target_key: "",
      last_target_url: "",
      last_targets: [],
      updated_at: now,
      reason: "passive_capture_only",
    },
    [COLLECTOR_WINDOW_KEY]: null,
  });
  sendHeartbeat().catch((e) => console.warn("[sw] collector passive heartbeat err", e?.message || e));
  return { ok: false, reason: "后台自动开页采集已关闭，仅在已打开的 Temu 页面被动采集" };
}

async function stopCollector() {
  const cfg = await getStorage([COLLECTOR_STATE_KEY, COLLECTOR_WINDOW_KEY]);
  const now = Date.now();
  await clearAlarm(ALARM_COLLECT);
  await setStorage({ [COLLECTOR_STATE_KEY]: { ...(cfg[COLLECTOR_STATE_KEY] || {}), enabled: false, stopped_at: now, updated_at: now } });
  const windowId = cfg[COLLECTOR_WINDOW_KEY];
  if (windowId) {
    try { await chrome.windows.remove(windowId); } catch {}
  }
  await setStorage({ [COLLECTOR_WINDOW_KEY]: null });
  await cleanupStrayCollectorTabs(null).catch(() => {});
  sendHeartbeat().catch((e) => console.warn("[sw] collector stop heartbeat err", e?.message || e));
  return { ok: true };
}

async function runCollectorStep(force = false) {
  const cfg = await getStorage([COLLECTOR_STATE_KEY, COLLECTOR_WINDOW_KEY]);
  if (cfg[COLLECTOR_WINDOW_KEY]) {
    try { await chrome.windows.remove(cfg[COLLECTOR_WINDOW_KEY]); } catch {}
  }
  await clearAlarm(ALARM_COLLECT);
  await cleanupStrayCollectorTabs(null).catch(() => {});
  await setStorage({
    [COLLECTOR_STATE_KEY]: {
      ...(cfg[COLLECTOR_STATE_KEY] || {}),
      enabled: false,
      updated_at: Date.now(),
      reason: "passive_capture_only",
    },
    [COLLECTOR_WINDOW_KEY]: null,
  });
  return { ok: false, reason: "passive_capture_only" };
}

function markCollectorUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(COLLECTOR_QUERY.split("=")[0], COLLECTOR_QUERY.split("=")[1]);
    return parsed.toString();
  } catch {
    const sep = String(url || "").includes("?") ? "&" : "?";
    return String(url || "") + sep + COLLECTOR_QUERY;
  }
}

function isCollectorTaggedUrl(url) {
  try {
    return new URL(String(url || "")).searchParams.get(COLLECTOR_QUERY.split("=")[0]) === COLLECTOR_QUERY.split("=")[1];
  } catch {
    return String(url || "").includes(COLLECTOR_QUERY);
  }
}

function isManagedCollectorWindow(win) {
  if (!win || win.type !== "popup") return false;
  const tabs = Array.isArray(win.tabs) ? win.tabs : [];
  return tabs.some((tab) => isCollectorTaggedUrl(tab?.url));
}

async function cleanupStrayCollectorTabs(collectorWindowId) {
  const allTabs = await chrome.tabs.query({
    url: [
      "https://agentseller.temu.com/*",
      "https://agentseller-us.temu.com/*",
      "https://agentseller-eu.temu.com/*",
      "https://seller.kuajingmaihuo.com/*",
    ],
  });
  const strayTabs = (Array.isArray(allTabs) ? allTabs : [])
    .filter((tab) => tab?.id && tab.windowId !== collectorWindowId && isCollectorTaggedUrl(tab.url));
  for (const tab of strayTabs) {
    try { await chrome.tabs.remove(tab.id); } catch {}
  }
}

async function handleCaptured(payload, sender) {
  // 注入店铺/账号上下文：从发送 tab 推断（mall_id 等需要从 cookie 或 userInfo 响应里拿，
  // userInfo 响应命中后记住店铺，后续同站点单店事件自动带上 mall_id）
  const knownMalls = (await getStorage([MALLS_KEY]))[MALLS_KEY] || [];
  const parsedMalls = collectMallInfos(payload);
  const matchedMall = parsedMalls[0] || inferMallFromKnownMalls(knownMalls, payload?.site);
  const enriched = {
    ...payload,
    mall_id: payload?.mall_id || payload?.mallId || matchedMall?.mallId || null,
    mall_name: payload?.mall_name || payload?.mallName || matchedMall?.mallName || null,
    tab_id: sender?.tab?.id,
    tab_url: sender?.tab?.url,
    captured_at: Date.now(),
  };
  if (parsedMalls.length) await rememberMalls(parsedMalls);
  await enqueue(enriched);
  await bumpStats({ captured_count_delta: 1 });
}

// ---------- 工具：storage / 累计统计 ----------
function clearAlarm(name) {
  return new Promise((resolve) => {
    try {
      chrome.alarms.clear(name, () => {
        void chrome.runtime.lastError;
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (v) => resolve(v || {})));
}
function setStorage(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function collectMallInfos(payload) {
  const body = payload?.body || safeParseJson(payload?.bodyText);
  const reqBody = payload?.reqBody || safeParseJson(payload?.requestBodyText);
  const reqHeaders = payload?.reqHeaders || null;
  const out = [];
  const seen = new Set();
  const stack = [body, reqBody, reqHeaders].filter(Boolean);
  let steps = 0;
  while (stack.length && steps < 8000) {
    steps++;
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }

    const rawMallId = node.mallId ?? node.mallID ?? node.mall_id ?? node.mallid ?? node.mallSupplierId ?? node.supplierId;
    if (rawMallId != null && rawMallId !== "") {
      const mallId = String(rawMallId).trim();
      if (mallId && !seen.has(mallId)) {
        seen.add(mallId);
        out.push({
          mallId,
          mallName: node.mallName || node.mall_name || node.shopName || node.storeName || node.supplierName || null,
          site: node.site || node.siteId || node.siteName || payload?.site || null,
          lastSeen: Date.now(),
        });
      }
    }
    for (const key of Object.keys(node)) stack.push(node[key]);
  }
  return out;
}

function safeParseJson(text) {
  if (!text || typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return null; }
}

function inferMallFromKnownMalls(malls, site) {
  if (!Array.isArray(malls) || !site) return null;
  const sameSite = malls.filter((m) => m?.site === site);
  if (!sameSite.length) return null;
  return sameSite.sort((a, b) => Number(b?.lastSeen || 0) - Number(a?.lastSeen || 0))[0] || null;
}

async function rememberMalls(malls) {
  const cur = (await getStorage([MALLS_KEY]))[MALLS_KEY] || [];
  const map = new Map();
  for (const item of Array.isArray(cur) ? cur : []) {
    if (!item?.mallId) continue;
    map.set(`${item.site || ""}|${item.mallId}`, item);
  }
  for (const item of malls) {
    if (!item?.mallId) continue;
    const key = `${item.site || ""}|${item.mallId}`;
    map.set(key, { ...(map.get(key) || {}), ...item, lastSeen: Date.now() });
  }
  const next = Array.from(map.values())
    .sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0))
    .slice(0, 50);
  await setStorage({ [MALLS_KEY]: next });
}

async function bumpStats(patch) {
  const cur = (await getStorage([STATS_KEY]))[STATS_KEY] || {
    captured_count: 0,
    last_capture_at: 0,
    last_flush_at: 0,
    last_flush_result: null,
  };
  if (patch.captured_count_delta) {
    cur.captured_count = (cur.captured_count || 0) + patch.captured_count_delta;
    cur.last_capture_at = Date.now();
  }
  if (patch.last_flush_at) cur.last_flush_at = patch.last_flush_at;
  if (patch.last_flush_result) cur.last_flush_result = patch.last_flush_result;
  if (typeof patch.last_flush_sent === "number") {
    cur.total_sent = (cur.total_sent || 0) + patch.last_flush_sent;
  }
  await setStorage({ [STATS_KEY]: cur });
}

// ---------- 商品列表 + 售后 page world 主动采集 ----------
// 原理：在已打开 agentseller tab 的 MAIN world 里调 fetch()，请求链为
//   fetch() → Temu wrap（自动注入 anti-content 签名） → TrackedFetch（hook.js clone + enqueue） → 原生 fetch → 网络
// 数据自动走 hook → flush → cloud 管道，不需要手动 enqueue。
// 条件：用户至少打开了一个 agentseller tab（不会创建新 tab、不打断用户浏览）。
async function collectProductsAndAfterSalesViaPage() {
  const cfg = await getStorage(["cloud_endpoint", "auth_token", PRODUCTS_STATE_KEY, AFTERSALES_STATE_KEY]);
  if (!cfg.cloud_endpoint || !cfg.auth_token) return { ok: false, reason: "not_configured" };
  const now = Date.now();

  const pState = cfg[PRODUCTS_STATE_KEY] || {};
  const aState = cfg[AFTERSALES_STATE_KEY] || {};
  const needProducts = !pState.last_success_at || now - Number(pState.last_success_at) >= PRODUCTS_RUN_INTERVAL_MS;
  const needAfterSales = !aState.last_success_at || now - Number(aState.last_success_at) >= AFTERSALES_RUN_INTERVAL_MS;
  if (!needProducts && !needAfterSales) return { ok: true, skipped: "interval" };

  // 获取所有已打开的 agentseller tabs，按 origin 去重取最近访问的
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({
      url: ["https://agentseller.temu.com/*", "https://agentseller-us.temu.com/*", "https://agentseller-eu.temu.com/*"],
    });
  } catch { return { ok: false, reason: "tabs_query_failed" }; }
  if (!tabs.length) return { ok: false, reason: "no_agentseller_tab" };

  const byOrigin = new Map();
  for (const tab of tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))) {
    let origin = "";
    try { origin = new URL(tab.url).origin; } catch { continue; }
    if (byOrigin.has(origin)) continue;
    let mallId = "";
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => (document.cookie.match(/mallid=([^;]+)/i)?.[1] || ""),
      });
      mallId = String(res?.result || "").trim();
    } catch { continue; }
    if (mallId) byOrigin.set(origin, { mallId, tabId: tab.id, origin });
  }
  if (!byOrigin.size) return { ok: false, reason: "no_mallid" };

  let productPages = 0;
  let afterSalesPages = 0;

  for (const { mallId, tabId } of byOrigin.values()) {
    // 商品列表采集：逐页 fetch，hook 自动捕获每页响应
    if (needProducts) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          args: [mallId, PRODUCTS_PAGE_SIZE, PRODUCTS_MAX_PAGES, PRODUCTS_PAGE_DELAY_MS],
          func: async (mid, pageSize, maxPages, delay) => {
            const s = (ms) => new Promise((r) => setTimeout(r, ms));
            let pages = 0;
            for (let page = 1; page <= maxPages; page++) {
              let n = 0;
              try {
                const r = await fetch("/visage-agent-seller/product/skc/pageQuery", {
                  method: "POST", credentials: "include", cache: "no-store",
                  headers: { "Content-Type": "application/json", mallid: mid },
                  body: JSON.stringify({ page, pageSize }),
                });
                const j = await r.json();
                n = ((j && j.result && (j.result.pageItems || j.result.list)) || []).length;
              } catch { break; }
              pages++;
              await s(delay);
              if (n < pageSize) break;
            }
            return pages;
          },
        });
        productPages += result?.result || 0;
      } catch (e) { console.warn("[sw] products page-world err", e?.message || e); }
    }

    // 售后采集：逐页 fetch，hook 自动捕获
    if (needAfterSales) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          args: [mallId, AFTERSALES_PAGE_SIZE, AFTERSALES_MAX_PAGES, AFTERSALES_PAGE_DELAY_MS],
          func: async (mid, pageSize, maxPages, delay) => {
            const s = (ms) => new Promise((r) => setTimeout(r, ms));
            let pages = 0;
            for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
              let n = 0;
              try {
                const r = await fetch("/mms/api/appalachian/afs/queryPageV3", {
                  method: "POST", credentials: "include", cache: "no-store",
                  headers: { "Content-Type": "application/json", mallid: mid },
                  body: JSON.stringify({ pageNo, pageSize }),
                });
                const j = await r.json();
                n = ((j && j.result && (j.result.pageItems || j.result.list || j.result.data)) || []).length;
              } catch { break; }
              pages++;
              await s(delay);
              if (n < pageSize) break;
            }
            return pages;
          },
        });
        afterSalesPages += result?.result || 0;
      } catch (e) { console.warn("[sw] aftersales page-world err", e?.message || e); }
    }
  }

  // 只要跑过且翻了页就记成功，下次走节流
  if (needProducts) {
    await setStorage({ [PRODUCTS_STATE_KEY]: { ...pState, last_run_at: now, ...(productPages > 0 ? { last_success_at: now } : {}), last_pages: productPages, last_malls: byOrigin.size } });
  }
  if (needAfterSales) {
    await setStorage({ [AFTERSALES_STATE_KEY]: { ...aState, last_run_at: now, ...(afterSalesPages > 0 ? { last_success_at: now } : {}), last_pages: afterSalesPages, last_malls: byOrigin.size } });
  }
  return { ok: true, productPages, afterSalesPages, malls: byOrigin.size };
}
