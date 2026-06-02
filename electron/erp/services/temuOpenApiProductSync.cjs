/**
 * Temu 官方开放平台「商品主数据」采集服务。
 *
 * 定时遍历已绑定 active 店铺 → 调 bg.glo.goods.list.get(PA网关) 全量翻页 →
 * upsert 到 erp.sqlite 的 erp_temu_openapi_products / erp_temu_openapi_skus。
 *
 * 纯函数 + 注入 db（不持有连接），供两处复用：
 *   - cron/systemd timer 脚本 scripts/sync-temu-openapi-products.cjs（syncAllMalls）
 *   - ipc.cjs 手动「立即采集」handler（syncOneMall / syncAllMalls）
 *
 * 实测依据：bg.glo.goods.list.get bizParams={page,pageSize}，返回 response.result.data[]，
 * 每项含 productId / productProperties[] / productSkuSummaries[{productSkuId,extCode,
 * productSkuWhExtAttr.productSkuWeight.value, productSkuVolume{len,width,height},
 * productSkuNewSensitiveAttr}] / productJitMode。
 */
"use strict";

const { callOpenApi, resolveTemuAppCredentials } = require("../temuOpenApiClient.cjs");

const GOODS_LIST_TYPE = "bg.glo.goods.list.get";
const GOODS_LIST_REGION = "PA"; // 已迁移接口固定走 PA 网关（与店铺绑定 region 无关）
const PAGE_SIZE = 100;
const MAX_PAGES = 500; // 安全上限，防分页死循环

function nowIso() {
  return new Date().toISOString();
}

/** 调一页，返回 { items }。结构：response.result.data[] */
async function fetchGoodsPage(creds, page) {
  const { ok, response } = await callOpenApi({
    type: GOODS_LIST_TYPE,
    appKey: creds.appKey,
    appSecret: creds.appSecret,
    accessToken: creds.accessToken,
    region: GOODS_LIST_REGION,
    bizParams: { page, pageSize: PAGE_SIZE },
  });
  if (!ok || !response || response.success === false) {
    const msg = response?.errorMsg || `errorCode=${response?.errorCode ?? "?"}`;
    throw new Error(`${GOODS_LIST_TYPE} 调用失败: ${msg}`);
  }
  const result = response.result || {};
  const items = Array.isArray(result.data)
    ? result.data
    : (Array.isArray(result.list) ? result.list : []);
  return { items };
}

function upsertProductWithSkus(db, mallId, item, now) {
  const productId = item.productId != null ? String(item.productId) : "";
  if (!productId) return 0;
  const skus = Array.isArray(item.productSkuSummaries) ? item.productSkuSummaries : [];

  db.prepare(`
    INSERT INTO erp_temu_openapi_products
      (mall_id, product_id, product_name, jit_mode, product_properties_json,
       sku_count, raw_json, last_synced_at, created_at, updated_at)
    VALUES (@mall_id,@product_id,@product_name,@jit_mode,@props,@sku_count,@raw,@now,@now,@now)
    ON CONFLICT(mall_id, product_id) DO UPDATE SET
      product_name=excluded.product_name,
      jit_mode=excluded.jit_mode,
      product_properties_json=excluded.product_properties_json,
      sku_count=excluded.sku_count,
      raw_json=excluded.raw_json,
      last_synced_at=excluded.last_synced_at,
      updated_at=excluded.updated_at
  `).run({
    mall_id: mallId,
    product_id: productId,
    product_name: item.productName ?? item.goodsName ?? null,
    jit_mode: item.productJitMode ? 1 : 0,
    props: JSON.stringify(item.productProperties || []),
    sku_count: skus.length,
    raw: JSON.stringify(item),
    now,
  });

  const upSku = db.prepare(`
    INSERT INTO erp_temu_openapi_skus
      (mall_id, product_sku_id, product_id, ext_code, weight_value, weight_unit,
       volume_len, volume_width, volume_height, sensitive_json, raw_json,
       last_synced_at, created_at, updated_at)
    VALUES (@mall_id,@sku_id,@product_id,@ext_code,@w,@wu,@l,@wd,@h,@sens,@raw,@now,@now,@now)
    ON CONFLICT(mall_id, product_sku_id) DO UPDATE SET
      product_id=excluded.product_id,
      ext_code=excluded.ext_code,
      weight_value=excluded.weight_value,
      weight_unit=excluded.weight_unit,
      volume_len=excluded.volume_len,
      volume_width=excluded.volume_width,
      volume_height=excluded.volume_height,
      sensitive_json=excluded.sensitive_json,
      raw_json=excluded.raw_json,
      last_synced_at=excluded.last_synced_at,
      updated_at=excluded.updated_at
  `);
  for (const s of skus) {
    const vol = s.productSkuVolume || {};
    const wt = (s.productSkuWhExtAttr && s.productSkuWhExtAttr.productSkuWeight) || {};
    upSku.run({
      mall_id: mallId,
      sku_id: s.productSkuId != null ? String(s.productSkuId) : "",
      product_id: productId,
      ext_code: s.extCode ?? null,
      w: wt.value ?? null,
      wu: wt.unit ?? null,
      l: vol.len ?? null,
      wd: vol.width ?? null,
      h: vol.height ?? null,
      sens: JSON.stringify(s.productSkuNewSensitiveAttr || {}),
      raw: JSON.stringify(s),
      now,
    });
  }
  return 1 + skus.length;
}

/**
 * 采集单店全部商品。成功后回写 erp_temu_openapi_auth 的采集状态列。
 * @returns {Promise<{mallId,productCount,rowCount,pages}>}
 */
async function syncOneMall(db, mallRow) {
  const mallId = mallRow.mall_id;
  const accessToken = mallRow.access_token;
  if (!accessToken) throw new Error(`店铺 ${mallId} 无 access_token`);
  const { appKey, appSecret } = resolveTemuAppCredentials({
    appKey: mallRow.app_key,
    appSecret: mallRow.app_secret,
  });
  const creds = { appKey, appSecret, accessToken };

  // 先翻页拉全到内存，再一个事务 upsert，缩小写锁窗口
  const allItems = [];
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    pages = page;
    const { items } = await fetchGoodsPage(creds, page);
    if (!items.length) break;
    allItems.push(...items);
    if (items.length < PAGE_SIZE) break;
  }

  const now = nowIso();
  let productCount = 0;
  let rowCount = 0;
  const tx = db.transaction((items) => {
    for (const it of items) {
      rowCount += upsertProductWithSkus(db, mallId, it, now);
      productCount += 1;
    }
  });
  tx(allItems);

  db.prepare(`
    UPDATE erp_temu_openapi_auth
    SET last_product_sync_at=@now,
        product_sync_count=@cnt,
        last_product_sync_status='ok',
        last_product_sync_error=NULL,
        updated_at=@now
    WHERE mall_id=@mall_id
  `).run({ now, cnt: productCount, mall_id: mallId });

  return { mallId, productCount, rowCount, pages };
}

/**
 * 采集所有 active 店铺，单店失败隔离（写 error 状态，不中断其它店）。
 * @returns {Promise<{malls:number, results:Array}>}
 */
async function syncAllMalls(db) {
  const malls = db.prepare(`
    SELECT * FROM erp_temu_openapi_auth
    WHERE status='active' AND access_token IS NOT NULL AND access_token <> ''
    ORDER BY updated_at DESC
  `).all();
  const results = [];
  for (const m of malls) {
    try {
      results.push({ ok: true, ...(await syncOneMall(db, m)) });
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 1000);
      try {
        db.prepare(`
          UPDATE erp_temu_openapi_auth
          SET last_product_sync_status='error', last_product_sync_error=@err, updated_at=@now
          WHERE mall_id=@mall_id
        `).run({ err: msg, now: nowIso(), mall_id: m.mall_id });
      } catch { /* 状态回写失败不致命 */ }
      results.push({ ok: false, mallId: m.mall_id, error: msg });
    }
  }
  return { malls: results.length, results };
}

module.exports = { syncOneMall, syncAllMalls };
