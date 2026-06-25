/**
 * TEMU 官方质检结果采集 + 物化(运营工作台/QC 中心「平台仓质检」)。
 *
 * 数据源(均在现有授权内,无需申请权限):
 *  - 列表 bg.goods.qualityinspection.get : pageInfo + skuQcResult(1合格/2不合格) + 时间窗 → result.total + skuList[]
 *  - 详情 bg.goods.qualityinspectiondetail.get : qcBillId → result.historyVOS[](倒序,取最新),含次品数/疵点/图
 *
 * 策略:默认只采【不合格】(skuQcResult=2,量小~几十/店),逐条拉详情取疵点/次品;物化到 erp_temu_openapi_qc(mig074)。
 * 凭证按店从 erp_temu_openapi_auth 读(全托管 active)。纯本地 erp.sqlite,不触 cloud。
 * 供 scripts/refresh-openapi-qc.cjs(cron) 调用;纯函数导出供测试。
 */
"use strict";

const { callOpenApi } = require("../temuOpenApiClient.cjs");
const { queryAll, execute, withTransaction } = require("../../db/connection.cjs");

const PAGE_SIZE = 50; // 质检列表 pageSize
const MAX_PAGES = 400; // 分页上限(防 runaway)
const MIN_INTERVAL_MS = 500; // 全局节流
const MAX_RETRIES = 4;

function s(v) {return v == null ? null : String(v);}
function num(v) {if (v == null) return null;const n = Number(v);return Number.isFinite(n) ? n : null;}
function sleep(ms) {return new Promise((r) => setTimeout(r, ms));}

let lastCallAt = 0;
async function throttle() {
  const w = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (w > 0) await sleep(w);
  lastCallAt = Date.now();
}

// 带节流 + 限流重试退避的调用。成功返回 response,彻底失败抛错。
async function callRetry(params) {
  let lastMsg = "";
  for (let i = 0; i <= MAX_RETRIES; i += 1) {
    await throttle();
    let response = null;
    try {({ response } = await callOpenApi(params));} catch (e) {response = { errorMsg: String(e && e.message || e) };}
    if (response && response.success === true) return response;
    const code = response && response.errorCode;
    lastMsg = response && response.errorMsg || `errorCode=${code}`;
    const retriable = code === 4000000 || /SYSTEM_EXCEPTION|limit|frequent|频繁|rate|timeout|超时/i.test(lastMsg);
    if (i < MAX_RETRIES && retriable) {await sleep(1000 * (i + 1));continue;}
    throw new Error(`${params.type} 失败: ${lastMsg}`);
  }
  throw new Error(`${params.type} 重试失败: ${lastMsg}`);
}

// 疵点列表 → 摘要文本 + 完整 JSON + 图片数。导出供测试。
function summarizeFlaws(flawList) {
  const flaws = Array.isArray(flawList) ? flawList : [];
  const parts = [];let imgs = 0;const json = [];
  for (const f of flaws) {
    const name = f.flawNameDesc || f.flawDesc || "";
    const deg = f.flawDegreeDesc || "";
    if (name || deg) parts.push(deg ? `${name}(${deg})` : name);
    const atts = Array.isArray(f.attachments) ? f.attachments : [];
    imgs += atts.length;
    json.push({ name: f.flawNameDesc || null, type: f.flawDesc || null, degree: f.flawDegreeDesc || null, degreeId: num(f.flawDegree), remark: f.remark || null, images: atts });
  }
  return { summary: parts.filter(Boolean).join("; ") || null, json: json.length ? JSON.stringify(json) : null, imageCount: imgs };
}

// 详情 response → 最新一条质检单的关键字段(次品/疵点)。无历史返回 null。导出供测试。
function parseQcDetail(resp) {
  const hist = resp && resp.result && Array.isArray(resp.result.historyVOS) ? resp.result.historyVOS : [];
  if (!hist.length) return null;
  const h = hist[0]; // historyVOS 按时间倒序,取最新
  const qd = h && h.qcDetail && typeof h.qcDetail === "object" ? h.qcDetail : {};
  const fl = summarizeFlaws(qd.flawDTOList);
  return {
    qc_result: num(h.qcResult),
    finish_time: s(h.finishTime),
    expect_qty: num(qd.expectQcQuantity),
    defective_qty: num(qd.defectiveQcQuantity),
    qc_group_name: s(qd.qcGroupName),
    receipt_no: s(qd.receiptNo),
    flaw_summary: fl.summary,
    flaws_json: fl.json,
    flaw_image_count: fl.imageCount
  };
}

// 列表项 → 基本字段。导出供测试。
function parseQcListItem(it) {
  return {
    qc_bill_id: s(it.qcBillId),
    product_sku_id: s(it.productSkuId),
    product_skc_id: s(it.productSkcId),
    spu_id: s(it.spuId),
    ext_code: it.skuExtCode != null && String(it.skuExtCode).trim() !== "" ? String(it.skuExtCode) : null,
    sku_name: s(it.skuName),
    spec: s(it.spec),
    cat_name: s(it.catName),
    purchase_no: s(it.purchaseNo),
    thumb_url: s(it.thumbUrl),
    qc_result_update_time: s(it.qcResultUpdateTime)
  };
}

// 采集单店质检(默认只不合格),逐条补详情。返回待 upsert 行数组。
async function collectQcForMall(db, mall, opts = {}) {
  const cred = { appKey: mall.app_key, appSecret: mall.app_secret, accessToken: mall.access_token, region: mall.region || "CN" };
  const onlyBad = opts.onlyBad !== false; // 默认 true
  const maxPages = opts.maxPages || MAX_PAGES; // 验证/限速可传小值
  const base = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const biz = { pageInfo: { pageNo: page, pageSize: PAGE_SIZE } };
    if (onlyBad) biz.skuQcResult = 2;
    if (opts.sinceMs) biz.qcResultUpdateTimeBegin = opts.sinceMs;
    const resp = await callRetry({ type: "bg.goods.qualityinspection.get", ...cred, bizParams: biz, timeoutMs: 20000 });
    const list = resp.result && Array.isArray(resp.result.skuList) ? resp.result.skuList : [];
    for (const it of list) base.push(parseQcListItem(it));
    const total = num(resp.result && resp.result.total) || 0;
    if (list.length === 0 || page * PAGE_SIZE >= total) break;
  }
  const out = [];
  for (const r of base) {
    let detail = null;
    if (r.qc_bill_id) {
      try {
        const d = await callRetry({ type: "bg.goods.qualityinspectiondetail.get", ...cred, bizParams: { qcBillId: Number(r.qc_bill_id) }, timeoutMs: 20000 });
        detail = parseQcDetail(d);
      } catch (e) {/* 详情失败不致命:保留列表行,详情字段留空 */}
    }
    out.push({
      ...r,
      mall_id: mall.mall_id,
      qc_result: detail && detail.qc_result != null ? detail.qc_result : onlyBad ? 2 : null,
      finish_time: detail ? detail.finish_time : null,
      expect_qty: detail ? detail.expect_qty : null,
      defective_qty: detail ? detail.defective_qty : null,
      qc_group_name: detail ? detail.qc_group_name : null,
      receipt_no: detail ? detail.receipt_no : null,
      flaw_summary: detail ? detail.flaw_summary : null,
      flaws_json: detail ? detail.flaws_json : null,
      flaw_image_count: detail ? detail.flaw_image_count : null
    });
  }
  return out;
}

const UPSERT_SQL = `INSERT INTO erp_temu_openapi_qc
  (mall_id,qc_bill_id,product_sku_id,product_skc_id,spu_id,ext_code,sku_name,spec,cat_name,purchase_no,thumb_url,qc_result,qc_result_update_time,finish_time,expect_qty,defective_qty,qc_group_name,receipt_no,flaw_summary,flaws_json,flaw_image_count,synced_at)
  VALUES (@mall_id,@qc_bill_id,@product_sku_id,@product_skc_id,@spu_id,@ext_code,@sku_name,@spec,@cat_name,@purchase_no,@thumb_url,@qc_result,@qc_result_update_time,@finish_time,@expect_qty,@defective_qty,@qc_group_name,@receipt_no,@flaw_summary,@flaws_json,@flaw_image_count,@synced_at)
  ON CONFLICT(mall_id,qc_bill_id) DO UPDATE SET
    product_sku_id=excluded.product_sku_id, product_skc_id=excluded.product_skc_id, spu_id=excluded.spu_id, ext_code=excluded.ext_code,
    sku_name=excluded.sku_name, spec=excluded.spec, cat_name=excluded.cat_name, purchase_no=excluded.purchase_no, thumb_url=excluded.thumb_url,
    qc_result=excluded.qc_result, qc_result_update_time=excluded.qc_result_update_time, finish_time=excluded.finish_time,
    expect_qty=excluded.expect_qty, defective_qty=excluded.defective_qty, qc_group_name=excluded.qc_group_name, receipt_no=excluded.receipt_no,
    flaw_summary=excluded.flaw_summary, flaws_json=excluded.flaws_json, flaw_image_count=excluded.flaw_image_count, synced_at=excluded.synced_at`;

// upsert 一批行(同店内 mall_id+qc_bill_id 唯一)。返回写入行数。
async function upsertQc(db, rows) {
  if (!rows.length) return 0;
  const now = new Date().toISOString();await withTransaction(db,

    async (txDb) => {const list =
      rows;for (const r of list) await execute(txDb, UPSERT_SQL, { ...r, synced_at: now });});
  return rows.length;
}

// 刷新所有全托管 active 店铺的质检(不合格)。返回汇总。
async function refreshQcAll(db, opts = {}) {
  const malls = await queryAll(db,
  "SELECT mall_id, mall_name, region, app_key, app_secret, access_token FROM erp_temu_openapi_auth WHERE status='active' AND semi_managed=0");

  let totalRows = 0;
  const perMall = [];
  const errors = [];
  for (const m of malls) {
    try {
      const rows = await collectQcForMall(db, m, opts);
      const n = await upsertQc(db, rows);
      totalRows += n;
      perMall.push({ mall: m.mall_id, rows: n });
    } catch (e) {
      errors.push({ mall: m.mall_id, error: e && e.message || String(e) });
    }
  }
  return { malls: malls.length, rows: totalRows, perMall, errors };
}

module.exports = { refreshQcAll, collectQcForMall, upsertQc, parseQcListItem, parseQcDetail, summarizeFlaws };