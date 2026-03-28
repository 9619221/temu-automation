/**
 * 通用工具函数
 */
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";

/**
 * 随机延迟
 */
export function randomDelay(min = 800, max = 2500) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

/**
 * 下载图片到本地
 */
export async function downloadImage(url, outputPath) {
  const proto = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    proto.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadImage(res.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(outputPath); });
    }).on("error", (e) => { fs.unlink(outputPath, () => {}); reject(e); });
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

/**
 * 获取调试目录路径
 */
export function getDebugDir() {
  const dir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 获取临时目录路径
 */
export function getTmpDir(subdir = "") {
  const dir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", subdir || "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
