/* 递归解开 raw_robot.code 的 zlib+base64 包装,输出明文 Python 源码 */
const fs = require("fs");
const zlib = require("zlib");

const src = process.argv[2];
const out = process.argv[3] || src + ".py";
let code = fs.readFileSync(src, "utf8");

function tryUnwrap(text) {
  // 匹配 base64.b64decode('....') 内的 base64
  const m = text.match(/b64decode\(\s*'([A-Za-z0-9+/=]+)'\s*\)/s)
    || text.match(/b64decode\(\s*"([A-Za-z0-9+/=]+)"\s*\)/s);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  // 可能是 zlib 压缩(zEcx... 头)或裸文本
  try {
    return zlib.inflateSync(buf).toString("utf8");
  } catch {
    try { return zlib.gunzipSync(buf).toString("utf8"); }
    catch { return buf.toString("utf8"); }
  }
}

let depth = 0;
while (depth < 12) {
  const next = tryUnwrap(code);
  if (next == null) break;
  code = next;
  depth += 1;
  // 若解出的还是包装层(含 exec(zlib.decompress(base64 ),继续
  if (!/b64decode\(/.test(code)) break;
}
fs.writeFileSync(out, code);
console.log(`解包层数=${depth} 输出=${out} 大小=${code.length}B`);
console.log("--- 前 600 字符 ---");
console.log(code.slice(0, 600));
