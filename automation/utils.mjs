/**
 * 通用工具函数
 */
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { getDelayScale } from "./runtime-config.mjs";

/**
 * 随机延迟
 */
export function randomDelay(min = 800, max = 2500) {
  const scale = getDelayScale();
  const scaledMin = Math.max(0, Math.round(min * scale));
  const scaledMax = Math.max(scaledMin, Math.round(max * scale));
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (scaledMax - scaledMin + 1)) + scaledMin));
}

/**
 * 下载图片到本地
 */
export async function downloadImage(url, outputPath) {
  const proto = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = proto.get(url, { timeout: 30000 }, (res) => {
      const statusCode = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        res.resume();
        downloadImage(redirectUrl, outputPath).then(resolve).catch(reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`下载图片失败: HTTP ${statusCode}`));
        return;
      }

      const file = fs.createWriteStream(outputPath);
      const cleanup = (err) => {
        file.destroy();
        fs.unlink(outputPath, () => {});
        reject(err);
      };

      res.on("error", cleanup);
      file.on("error", cleanup);
      res.pipe(file);
      file.on("finish", () => {
        file.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
            return;
          }
          resolve(outputPath);
        });
      });
    });

    req.on("error", (e) => {
      fs.unlink(outputPath, () => {});
      reject(e);
    });
  });
}

/**
 * 保存 base64 图片到文件
 */
export function saveBase64Image(dataUrl, outputPath) {
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  fs.writeFileSync(outputPath, Buffer.from(base64Data, "base64"));
  return outputPath;
}

export function getAppDataRoot() {
  const dir = process.env.APP_USER_DATA
    || path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 获取调试目录路径
 */
export function getDebugDir() {
  const dir = path.join(getAppDataRoot(), "debug");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 获取临时目录路径
 */
export function getTmpDir(subdir = "") {
  const dir = path.join(getAppDataRoot(), subdir || "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 错误码体系
 */
export const ERR = {
  // 浏览器/认证
  BROWSER_LAUNCH: "BROWSER_LAUNCH",
  AUTH_EXPIRED: "AUTH_EXPIRED",
  LOGIN_FAILED: "LOGIN_FAILED",
  NAV_FAILED: "NAV_FAILED",
  // 采集
  SCRAPE_TIMEOUT: "SCRAPE_TIMEOUT",
  SCRAPE_NO_DATA: "SCRAPE_NO_DATA",
  SCRAPE_PAGE_ERROR: "SCRAPE_PAGE_ERROR",
  // 上品
  CATEGORY_NOT_FOUND: "CATEGORY_NOT_FOUND",
  ATTR_MISMATCH: "ATTR_MISMATCH",
  IMAGE_UPLOAD_FAILED: "IMAGE_UPLOAD_FAILED",
  SUBMIT_FAILED: "SUBMIT_FAILED",
  AI_GEN_FAILED: "AI_GEN_FAILED",
  // 通用
  NETWORK_ERROR: "NETWORK_ERROR",
  UNKNOWN: "UNKNOWN",
};

/**
 * 静默日志：替代空 catch {}，记录错误但不中断流程
 * @param {string} context - 调用位置描述（如 "login.checkbox"）
 * @param {Error} err - 错误对象
 * @param {string} [level="debug"] - 日志级别: "debug"(仅开发时关注) | "warn"(潜在问题) | "error"(需要关注)
 */
export function logSilent(context, err, level = "debug") {
  const msg = `[${context}] ${err?.message || err || "unknown error"}`;
  if (level === "error") {
    console.error(`[ERROR] ${msg}`);
  } else if (level === "warn") {
    console.error(`[WARN] ${msg}`);
  }
  // debug 级别不输出，避免刷屏（可通过环境变量开启）
  else if (process.env.DEBUG_SILENT) {
    console.error(`[DEBUG] ${msg}`);
  }
}
