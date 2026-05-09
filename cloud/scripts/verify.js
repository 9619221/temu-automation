// 一键看「扩展 → 云端 → SKC 聚合」整套链路状态
// 用法：cd cloud && npm run verify

import { getDb } from "../db/connection.js";

const db = getDb();
const q1 = (sql) => db.prepare(sql).get().n;

const events = q1("SELECT COUNT(*) AS n FROM capture_events");
const malls = q1("SELECT COUNT(*) AS n FROM mall_accounts");
const links = q1("SELECT COUNT(*) AS n FROM device_mall_links");
const skc = q1("SELECT COUNT(*) AS n FROM skc_snapshots");
const skcPriced = q1("SELECT COUNT(*) AS n FROM skc_snapshots WHERE declared_price_cents IS NOT NULL OR suggested_price_cents IS NOT NULL");
const devices = q1("SELECT COUNT(*) AS n FROM devices");

const ok = (b) => b ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";

console.log("");
console.log("═══ 链路自检 ═══");
console.log(`${ok(events > 0)} 扩展上报         capture_events    = ${events}`);
console.log(`${ok(devices > 0)} 设备登记         devices           = ${devices}`);
console.log(`${ok(malls > 0)} 店铺识别（userInfo parser）  mall_accounts     = ${malls}`);
console.log(`${ok(links > 0)} 设备↔店铺关联   device_mall_links = ${links}`);
console.log(`${ok(skc > 0)} SKC 主体聚合     skc_snapshots     = ${skc}`);
console.log(`${ok(skcPriced > 0)} SKC 价格已抓     带价格的 SKC      = ${skcPriced}`);
console.log("");

if (events > 0) {
  console.log("─── Top 抓到的接口 ───");
  const top = db.prepare("SELECT url_path, COUNT(*) AS n FROM capture_events GROUP BY url_path ORDER BY n DESC LIMIT 8").all();
  for (const r of top) console.log(`  ${String(r.n).padStart(4)}  ${r.url_path}`);
  console.log("");
}

if (skc > 0) {
  console.log("─── SKC 样本（最近 5 条）───");
  const samples = db.prepare(`
    SELECT skc_id, product_id, mall_id, title, declared_price_cents, suggested_price_cents, price_currency
    FROM skc_snapshots ORDER BY last_updated_at DESC LIMIT 5
  `).all();
  for (const s of samples) {
    const dp = s.declared_price_cents != null ? `${(s.declared_price_cents/100).toFixed(2)}${s.price_currency || ""}` : "—";
    const sp = s.suggested_price_cents != null ? `${(s.suggested_price_cents/100).toFixed(2)}${s.price_currency || ""}` : "—";
    console.log(`  skc=${s.skc_id} mall=${s.mall_id || "?"}  declared=${dp}  suggested=${sp}  ${(s.title || "").slice(0, 30)}`);
  }
  console.log("");
}

const allGood = events > 0 && devices > 0 && malls > 0 && skc > 0;
const partial = events > 0 && skc === 0;

if (allGood) {
  console.log("\x1b[32m✓ 链路通了。可以打开桌面端 PriceReview 试「云端预览」按钮。\x1b[0m");
} else if (partial) {
  console.log("\x1b[33m⚠ 上报通了但 SKC parser 没命中。多半是 Temu 实际响应字段名跟 parser 猜的不一样。\x1b[0m");
  console.log("  排查：查一条原始 body 对比 schema：");
  console.log("    curl http://localhost:8788/api/dashboard/events?url_path=skc/pageQuery&limit=1 -H 'Authorization: Bearer <TOKEN>'");
  console.log("    然后调整 cloud/parsers/skc.js 里 pickList / firstDefined 的字段名");
} else if (events === 0) {
  console.log("\x1b[33m⚠ 云端没收到任何上报。检查：\x1b[0m");
  console.log("  1) 扩展是否装好（chrome://extensions/ 看是否启用）");
  console.log("  2) 扩展设置页 URL 是否填 http://localhost:8788、token 是否对");
  console.log("  3) 是否在 Temu 卖家后台已登录页（agentseller.temu.com / seller.kuajingmaihuo.com）翻动过");
  console.log("  4) 扩展 SW DevTools console 有没有错误");
}
