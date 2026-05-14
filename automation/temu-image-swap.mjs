/**
 * Temu 卖家后台 SPU 主图/轮播图批量替换 — 纯 API 实现
 *
 * 拆成两步：
 *   - listSpuImageFiles：纯文件系统，按字典序枚举子文件夹里的图片
 *   - submitProductImageEdit：在已登录的 Temu agentseller 页里 page.evaluate
 *       1) POST /visage-agent-seller/product/queryForImage  拿当前商品 schema
 *       2) POST /visage-agent-seller/product/image/edit     带新 carouselImageUrls 提交
 *
 * 上传到素材库走 worker.mjs 已有的 uploadImageToMaterial（/api/galerie/v3/store_image）。
 */

import fs from "fs";
import path from "path";

const SUPPORTED_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// Temu 轮播图硬约束（接口和 UI 都校验）
export const CAROUSEL_MIN = 5;
export const CAROUSEL_MAX = 10;

function isSupportedImageFile(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  return SUPPORTED_EXTS.has(ext);
}

/**
 * 扫描 rootDir 下与 identifier（SPU/SKC 号）同名的子文件夹，
 * 按文件名字典序返回里面所有支持的图片文件绝对路径。
 *
 * 没有子文件夹返回 { exists: false, files: [] }，
 * 有子文件夹但没图返回 { exists: true, files: [] }。
 */
export function listSpuImageFiles(rootDir, identifier) {
  const root = String(rootDir || "").trim();
  const id = String(identifier || "").trim();
  if (!root || !id) return { exists: false, files: [], dir: "" };

  const dir = path.join(root, id);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { exists: false, files: [], dir };
  }

  const entries = fs.readdirSync(dir);
  const files = entries
    .filter((name) => isSupportedImageFile(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }))
    .map((name) => path.join(dir, name));

  return { exists: true, files, dir };
}

/**
 * 把已上传到 Temu 素材中心的图片 URL 数组提交为商品轮播图（含主图）。
 *
 * @param {import("playwright").Page} page  已登录 agentseller.temu.com 的页面
 * @param {string|number} productId          SPU 号（image/edit 接的是 productId）
 * @param {string[]} newImageUrls            素材中心 store_image 返回的 URL 数组，按目标顺序排好
 *                                           第一张自动作为主图（materialImgUrl）
 * @returns {Promise<{success:boolean, errorCode?:number, errorMsg?:string, payload?:object, response?:any}>}
 */
export async function submitProductImageEdit(page, productId, newImageUrls) {
  const pid = String(productId || "").trim();
  if (!pid) return { success: false, errorMsg: "缺少 productId" };

  const urls = Array.isArray(newImageUrls) ? newImageUrls.filter((u) => typeof u === "string" && u) : [];
  if (urls.length < CAROUSEL_MIN || urls.length > CAROUSEL_MAX) {
    return { success: false, errorMsg: `轮播图必须 ${CAROUSEL_MIN}-${CAROUSEL_MAX} 张，实际 ${urls.length} 张` };
  }

  return await page.evaluate(async ({ pid, urls }) => {
    const mallid = document.cookie.match(/mallid=([^;]+)/)?.[1] || "";
    const headers = { "Content-Type": "application/json", "mallid": mallid };
    const productIdNum = Number(pid);

    // Step 1: 拿当前商品 schema（保留语言/SKC/分类等不动，只替换图字段）
    const queryResp = await fetch("/visage-agent-seller/product/queryForImage", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ productId: productIdNum }),
    });
    if (!queryResp.ok) {
      return { success: false, errorMsg: `queryForImage HTTP ${queryResp.status}` };
    }
    const queryData = await queryResp.json();
    if (!queryData?.success || !queryData?.result) {
      return {
        success: false,
        errorCode: queryData?.errorCode,
        errorMsg: "queryForImage 失败: " + (queryData?.errorMsg || JSON.stringify(queryData).slice(0, 200)),
      };
    }
    const cur = queryData.result;

    // Step 2: 拿对应任务 ID（image/edit 必须带 optimizeTaskUid，从 phoenix-mms 任务列表反查）
    let optimizeTaskUid = null;
    try {
      const taskResp = await fetch("/phoenix-mms/picture/task/pageQuery", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ pageInfo: { pageNo: 1, pageSize: 10 }, productIdList: [productIdNum] }),
      });
      const taskData = await taskResp.json();
      const t0 = taskData?.result?.detailList?.[0]?.taskList?.[0];
      optimizeTaskUid = t0?.taskId ?? null;
    } catch (_) { /* 拿不到 task 也尝试提交 */ }

    // Step 3: 构造 image/edit payload
    // TODO(image-swap): 当前 payload 报 errorCode 1000002 "Image task cannot be empty"，
    //   推断需要按 SKC 维度组装 productSkcList[].productSkcCarouselImageI18nVOList
    //   （form 内部叫 carouselImgsI18n.common[].{status,uid,url,beautifyTag,isTranslate}）。
    //   待用户在 Electron 真实跑一次提交、抓 HAR 拿到完整 payload 后补完。
    const payload = {
      ...cur,
      optimizeTaskUid,
      carouselImageUrls: urls,
      materialImgUrl: urls[0],
    };

    const editResp = await fetch("/visage-agent-seller/product/image/edit", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!editResp.ok) {
      return { success: false, errorMsg: `image/edit HTTP ${editResp.status}`, payload };
    }
    const editData = await editResp.json();
    return {
      success: !!editData?.success,
      errorCode: editData?.errorCode,
      errorMsg: editData?.errorMsg || null,
      response: editData?.result ?? null,
      payload,
    };
  }, { pid, urls });
}
