/**
 * 官方 OpenAPI 端到端验真探针（临时脚本，验证用）
 *
 * 用内置沙箱账号实调：
 *   1. bg.mall.info.get  —— 验证签名 + 鉴权是否仍有效
 *   2. bg.goods.list.get (CN) / bg.glo.goods.list.get (PA) —— 拿真实商品列表，看返回字段
 *
 * 跑法：node scripts/probe-openapi-verify.mjs
 */
import { callOpenApi } from "../automation/temu-open-api.mjs";

// 文档「基本信息」页最新测试账号（2026-05-18 刷新）
// 全托账号1（CN 区）
const creds = {
  appKey: "47bb4bb7769e12d9f7aa93cf029fe529",
  appSecret: "ac0a3e952eaaa5b19c0e615c2ef497f50afa6e49",
  accessToken: "uwarl3tp3lr1jf5iodbhnzbkt9osyst7kdlxaisahvvpzfmuhiiajh81",
  region: "CN",
  storeId: "1052202882",
  storeName: "girl clothes",
};
// 半托账号1（PA 区）
const credsPA = {
  appKey: "47bb4bb7769e12d9f7aa93cf029fe529",
  appSecret: "ac0a3e952eaaa5b19c0e615c2ef497f50afa6e49",
  accessToken: "rd0gvgae746nxmdbx7fkol7jrurjmxpjrteiw6mflnrqeviek6akzygz",
  region: "PA",
  storeId: "634418215494106",
  storeName: "girl clothesss",
};

function dump(label, r) {
  console.log("\n========== " + label + " ==========");
  console.log("HTTP", r.status, "ok=", r.ok);
  // 只打印响应，不打印 signedParams（含 token）
  const resp = r.response || {};
  const json = JSON.stringify(resp, null, 2);
  console.log(json.length > 6000 ? json.slice(0, 6000) + "\n...[截断]" : json);
}

async function main() {
  console.log("沙箱账号:", creds.storeName, "storeId=", creds.storeId, "region=", creds.region);

  // 1) 验签最小接口
  const mall = await callOpenApi({ ...creds, type: "bg.mall.info.get", bizParams: {} });
  dump("bg.mall.info.get (CN 验签)", mall);

  // 2) 授权信息（看 token 带哪些接口权限）
  const tok = await callOpenApi({ ...creds, type: "bg.open.accesstoken.info.get", bizParams: {} });
  dump("bg.open.accesstoken.info.get (CN 授权范围)", tok);

  // 3) 商品列表 CN
  const listCN = await callOpenApi({
    ...creds,
    type: "bg.goods.list.get",
    bizParams: { page: 1, pageSize: 3 },
  });
  dump("bg.goods.list.get (CN 商品列表 page=1 size=3)", listCN);

  // 4) 商品详情 CN —— 先拿一个 productId
  const first = listCN.response?.result?.goodsList?.[0] || listCN.response?.result?.dataList?.[0] || listCN.response?.result?.list?.[0];
  const pid = first?.productId || first?.goodsId;
  if (pid) {
    const detail = await callOpenApi({ ...creds, type: "bg.goods.detail.get", bizParams: { productId: Number(pid) } });
    dump(`bg.goods.detail.get (CN productId=${pid})`, detail);
  } else {
    console.log("\n[skip] 未从商品列表解析到 productId，跳过 detail.get");
  }

  // 5) 商品列表 PA（glo，半托账号）
  const listPA = await callOpenApi({
    ...credsPA,
    type: "bg.glo.goods.list.get",
    bizParams: { page: 1, pageSize: 3 },
  });
  dump("bg.glo.goods.list.get (PA 半托商品列表 page=1 size=3)", listPA);
}

main().catch((e) => {
  console.error("探针异常:", e);
  process.exit(1);
});
