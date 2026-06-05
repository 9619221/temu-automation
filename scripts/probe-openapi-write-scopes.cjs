/**
 * 探针：检查「采购单写操作」+「商品编辑」相关接口在各店 token 的授权范围(apiScopeList)。
 *
 * 纯读 bg.open.accesstoken.info.get，零副作用——不实调任何写接口，不碰真实备货/商品。
 * 输出：每个目标接口在多少个店被授权 + 一个样本店的完整授权清单。
 *
 * 用法（服务器上跑，service 同环境拿 APP_SECRET）：
 *   TEMU_OPENAPI_APP_SECRET=xxx node scripts/probe-openapi-write-scopes.cjs [limitStores]
 *   limitStores 省略=全部店；传数字=只跑前 N 个店（各店授权一般一致，先跑 3 个即可定性）。
 */
"use strict";
const { callOpenApi } = require("/opt/temu-automation/electron/erp/temuOpenApiClient.cjs");
const db = require("better-sqlite3")("/opt/temu-erp-data/erp.sqlite");
const APP_KEY = process.env.TEMU_OPENAPI_APP_KEY || "10342bb30388adfe9926322a38ab350e";
const APP_SECRET = process.env.TEMU_OPENAPI_APP_SECRET || "";
if (!APP_SECRET) { console.error("缺 TEMU_OPENAPI_APP_SECRET（service 环境里有，命令行需自行注入）"); process.exit(1); }

// 目标接口：采购写 + 商品编辑。用 token 的 apiScopeList 查授权，绝不实调。
const TARGETS = {
  "采购-创建备货单": "bg.purchaseorder.apply",
  "采购-改备货量": "bg.purchaseorder.edit",
  "采购-取消备货单": "bg.purchaseorder.cancel",
  "采购-预估体积": "bg.predict.volume.get",
  // 商品编辑：本应用授权的是 bg.glo.* 版(走 PA 网关)，不是全托管 bg.goods.* 版。
  "商品-详情查询": "bg.glo.goods.detail.get",
  "商品-改运费模板": "bg.glo.goodslogistics.template.edit",
  "商品-改图素材": "bg.glo.goods.edit.pictures.submit",
  "商品-编辑属性": "bg.glo.goods.edit.property",
  "商品-新增属性": "bg.glo.goods.add.property",
  "商品-改尺码表模板": "bg.glo.goods.size.template.edit",
  "商品-通用更新产地": "bg.glo.goods.update",
  "商品-敏感属性": "bg.glo.goods.edit.sensitive.attr",
  "商品-修改单apply": "bg.glo.goods.edit.task.apply",
  "商品-修改单submit": "bg.glo.goods.edit.task.submit",
  "商品-改说明书": "bg.glo.goods.edit.guide.file",
  "商品-发新品": "bg.glo.goods.add",
  // 商品编辑前置(查类目/属性/规格)
  "前置-类目树": "bg.glo.goods.cats.get",
  "前置-属性模板": "bg.glo.goods.attrs.get",
  "前置-规格创建": "bg.glo.goods.spec.create",
};

const limit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
let stores = db.prepare("SELECT mall_id, region, access_token FROM erp_temu_openapi_auth WHERE status='active' ORDER BY mall_id").all();
const totalActive = stores.length;
if (limit) stores = stores.slice(0, limit);
console.log(`# active 店铺总数: ${totalActive}，本次探测: ${stores.length}\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (s, n) => (s + "                  ").slice(0, n);

(async () => {
  const cover = {}; for (const k of Object.values(TARGETS)) cover[k] = [];
  let allScopeSample = null, sampleMall = null, okStores = 0;

  for (const s of stores) {
    const region = s.region || "CN";
    const tokenType = region === "CN" ? "bg.open.accesstoken.info.get" : "bg.open.accesstoken.info.get.global";
    try {
      const r = await callOpenApi({ type: tokenType, appKey: APP_KEY, appSecret: APP_SECRET, accessToken: s.access_token, region, bizParams: {}, timeoutMs: 25000 });
      const b = r.response || {};
      if (b.success && b.result && Array.isArray(b.result.apiScopeList)) {
        const scopes = new Set(b.result.apiScopeList);
        okStores++;
        if (!allScopeSample) { allScopeSample = b.result.apiScopeList.slice().sort(); sampleMall = s.mall_id; }
        for (const t of Object.values(TARGETS)) if (scopes.has(t)) cover[t].push(s.mall_id);
      } else {
        console.log(`[skip] mall=${s.mall_id} token失败 code=${b.errorCode} ${b.errorMsg || ""}`);
      }
    } catch (e) { console.log(`[err]  mall=${s.mall_id} ${e.message}`); }
    await sleep(500);
  }

  console.log(`\n# 成功拿到授权清单的店: ${okStores}/${stores.length}\n`);
  console.log("# ===== 目标接口授权覆盖 =====");
  for (const [label, type] of Object.entries(TARGETS)) {
    const n = cover[type].length;
    const mark = okStores === 0 ? "  ?  " : n === okStores ? "✅全部" : n === 0 ? "❌全无" : `⚠️${pad(n + "/" + okStores, 5)}`;
    console.log(`${mark}  ${pad(label, 18)} ${type}`);
  }

  if (allScopeSample) {
    console.log(`\n# 样本店 mall=${sampleMall} 完整授权清单(${allScopeSample.length} 项):`);
    console.log(allScopeSample.join("\n"));
  }
})();
