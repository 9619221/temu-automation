#!/usr/bin/env node
// Worker API 调用脚本 - 解决 Windows curl 引号问题
// 用法: node worker-call.mjs <action> [key=value ...]
// 示例: node worker-call.mjs ping
//       node worker-call.mjs scrape_all
//       node worker-call.mjs scrape_products

import http from 'http';

const action = process.argv[2] || 'ping';
const params = {};
process.argv.slice(3).forEach(arg => {
  const [k, v] = arg.split('=');
  if (k && v) params[k] = v;
});

const port = parseInt(process.env.WORKER_PORT || '19280');
const data = JSON.stringify({ action, params });

const req = http.request({
  hostname: 'localhost',
  port,
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
  timeout: 1800000, // 30 min
}, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(body);
    }
  });
});

req.on('error', err => {
  console.error(`Worker 连接失败 (localhost:${port}): ${err.message}`);
  process.exit(1);
});

req.write(data);
req.end();
