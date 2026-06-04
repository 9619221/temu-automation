// 全量/增量铺平台质检「列表缩略图」:对每个不合格单,实时调详情拿第一张疵点图,
// 下载 64px 小缩略存数据盘缓存 {qcBillId}/thumb.jpg(已存则跳过=增量),供列表内嵌直显。
// 用法: cd /opt/temu-automation && node scripts/refresh-qc-thumbs.cjs >> /var/log/temu-openapi-qc.log 2>&1
"use strict";
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const ERP_DB = process.env.ERP_DB || "/opt/temu-erp-data/erp.sqlite";
const CACHE = process.env.QC_FLAW_CACHE_DIR || "/opt/temu-erp-data/qc-flaw-cache";
const db = new Database(ERP_DB);
db.pragma("busy_timeout=60000");
const { callOpenApi } = require("../electron/erp/temuOpenApiClient.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const rows = db.prepare("SELECT qc_bill_id, mall_id FROM erp_temu_openapi_qc WHERE qc_result=2 AND flaw_image_count>0 ORDER BY qc_result_update_time DESC").all();
  const creds = {};
  for (const m of db.prepare("SELECT mall_id,app_key,app_secret,access_token,region FROM erp_temu_openapi_auth WHERE status='active'").all()) creds[m.mall_id] = m;
  let done = 0, skip = 0, fail = 0;
  const t0 = Date.now();
  for (const r of rows) {
    const dir = path.join(CACHE, String(r.qc_bill_id).replace(/[^0-9a-zA-Z_-]/g, ""));
    const thumb = path.join(dir, "thumb.jpg");
    if (fs.existsSync(thumb)) { skip += 1; continue; } // 增量:已有跳过
    const m = creds[r.mall_id];
    if (!m) { fail += 1; continue; }
    try {
      const resp = await callOpenApi({ type: "bg.goods.qualityinspectiondetail.get", appKey: m.app_key, appSecret: m.app_secret, accessToken: m.access_token, region: m.region || "CN", bizParams: { qcBillId: Number(r.qc_bill_id) }, timeoutMs: 20000 });
      let url = null;
      const hist = (resp.response && resp.response.result && resp.response.result.historyVOS) || [];
      for (const h of hist) for (const f of ((h.qcDetail && h.qcDetail.flawDTOList) || [])) for (const u of (f.attachments || [])) { if (!url) url = u; }
      if (!url) { fail += 1; continue; }
      const tu = url + (url.includes("?") ? "&" : "?") + "imageMogr2/thumbnail/64x";
      const ir = await fetch(tu, { headers: { Referer: "https://kuajingmaihuo.com/", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" } });
      if (!ir.ok) { fail += 1; continue; }
      const buf = Buffer.from(await ir.arrayBuffer());
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(thumb, buf);
      done += 1;
      if (done % 50 === 0) console.log(new Date().toISOString(), `qc-thumb 进度 done=${done} skip=${skip} fail=${fail}/${rows.length}`);
      await sleep(250); // 节流
    } catch (e) { fail += 1; }
  }
  console.log(new Date().toISOString(), `qc-thumb 铺完 done=${done} skip=${skip} fail=${fail} total=${rows.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  db.close();
})().catch((e) => { console.error("qc-thumb 失败:", e && e.message); process.exit(1); });
