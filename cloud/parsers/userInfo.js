// 解 userInfo / mms/userInfo / account/menu 这类响应里的 mall 列表，
// 写入 mall_accounts + device_mall_links。后续 dashboard 可以按 device 推断 mall。
//
// Temu 各域返回结构差异较大，统一用「深度遍历找 mallId 字段」的宽松策略：
// 任何对象上同时出现 mallId（或 mall_id）就当作一条 mall 记录。

import crypto from "crypto";

function collectMallInfos(body) {
  const out = [];
  const seen = new Set();
  const stack = [body];
  let steps = 0;
  while (stack.length && steps < 10000) {
    steps++;
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const x of node) stack.push(x);
      continue;
    }
    const rawMallId = node.mallId ?? node.mall_id;
    if (rawMallId != null && rawMallId !== "") {
      const mall_id = String(rawMallId).trim();
      if (mall_id && !seen.has(mall_id)) {
        seen.add(mall_id);
        out.push({
          mall_id,
          mall_name: node.mallName || node.mall_name || node.shopName || node.storeName || null,
          site: node.site || node.siteId || node.siteName || node.region || null,
        });
      }
    }
    for (const k of Object.keys(node)) stack.push(node[k]);
  }
  return out;
}

export function parseUserInfo(db, ctx, evt, body) {
  const malls = collectMallInfos(body);
  if (!malls.length) return;

  const upsertMall = db.prepare(`
    INSERT INTO mall_accounts (id, tenant_id, site, mall_id, mall_name, last_seen)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, site, mall_id) DO UPDATE SET
      mall_name = COALESCE(excluded.mall_name, mall_accounts.mall_name),
      last_seen = excluded.last_seen
  `);
  const upsertLink = db.prepare(`
    INSERT INTO device_mall_links (tenant_id, device_id, mall_id, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id, mall_id) DO UPDATE SET last_seen = excluded.last_seen
  `);

  const now = Date.now();
  for (const m of malls) {
    upsertMall.run(crypto.randomUUID(), ctx.tenant_id, m.site || evt.site || "", m.mall_id, m.mall_name);
    if (ctx.device_id) {
      upsertLink.run(ctx.tenant_id, ctx.device_id, m.mall_id, now);
    }
  }
}
