/**
 * 导出 token 授权接口清单（apiScopeList），按字母排序，临时脚本。
 * node scripts/probe-openapi-scopes.mjs
 */
import { callOpenApi } from "../automation/temu-open-api.mjs";

const creds = {
  appKey: "47bb4bb7769e12d9f7aa93cf029fe529",
  appSecret: "ac0a3e952eaaa5b19c0e615c2ef497f50afa6e49",
  accessToken: "uwarl3tp3lr1jf5iodbhnzbkt9osyst7kdlxaisahvvpzfmuhiiajh81",
  region: "CN",
};

const r = await callOpenApi({ ...creds, type: "bg.open.accesstoken.info.get", bizParams: {} });
const scopes = (r.response?.result?.apiScopeList || []).slice().sort();
console.log("总数:", scopes.length);
console.log(scopes.join("\n"));
