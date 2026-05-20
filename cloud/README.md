# Temu 多店监控 · 云端 (M2 骨架)

接收浏览器扩展上报的 Temu 卖家后台业务接口数据，做多店统一汇总。

## 技术栈

- Node.js + Express（ESM）
- better-sqlite3（开箱即用，后续可换 PG）
- jsonwebtoken + bcryptjs

## 路由

| Method + Path | 鉴权 | 用途 |
|---|---|---|
| `GET /` | – | server 名/版本 |
| `POST /api/auth/login` | – | `{username,password}` → JWT |
| `GET /api/auth/me` | ✓ | 当前用户 |
| `GET /api/ingest/v1/health` | ✓ | 扩展启动时连通测试 |
| `POST /api/ingest/v1/batch` | ✓ | 扩展上报 `{items:[...]}` |
| `GET /api/hook/v1/inject.js` | ✓ | 扩展拉远端 page world hook（带 ETag） |
| `GET /api/hook/v1/config` | ✓ | 白名单/黑名单 JSON |
| `GET /api/dashboard/stats` | ✓ | 总览 |
| `GET /api/dashboard/agent` | ✓ | 扩展心跳 / 安装状态 |
| `GET /api/dashboard/events` | ✓ | 时序事件查询 |
| `GET /api/dashboard/event/:id/body` | ✓ | 单条原始 body |

## 数据库

文件路径 `cloud/data/temu-cloud.sqlite`（自动创建，WAL 模式）。

表：`tenants` / `users` / `devices` / `mall_accounts` / `capture_events` / `api_endpoint_stats`。

迁移脚本在 [`db/migrations/`](db/migrations/)，启动时自动 apply。

## 启动

```bash
cd cloud
npm install
cp .env.example .env       # 改 JWT_SECRET，改 PORT
npm run seed               # 创建 admin 用户（默认密码 changeme123）
# npm run seed myPassword  # 自定义密码
npm run dev                # 起 server，--watch 热重载
```

服务起在 `http://localhost:8788`。

## 让扩展接入

1. 扩展点图标 → 「打开设置」
2. 云端 URL：`http://localhost:8788`（生产环境必须 https）
3. 拿 JWT：
   ```bash
   curl -X POST http://localhost:8788/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"changeme123"}'
   ```
4. 把返回的 `token` 粘到扩展设置里，「测试连通性」应该 200 OK
5. 进 Temu 卖家后台开点菜单，30s 后扩展自动批量上报

## 验证扩展上报数据

```bash
TOKEN="<上一步拿到的 JWT>"

# 总览
curl http://localhost:8788/api/dashboard/stats -H "Authorization: Bearer $TOKEN" | jq

# 看商品列表接口的最近 20 条上报
curl "http://localhost:8788/api/dashboard/events?url_path=skc/pageQuery&limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq

# 看某条原始 body
curl "http://localhost:8788/api/dashboard/event/<id>/body" \
  -H "Authorization: Bearer $TOKEN" | jq
```

## 部署到生产

- 用反向代理（nginx / caddy）套 https
- `JWT_SECRET` 设成长随机串（`openssl rand -hex 32`）
- 数据库文件挂到持久化卷
- 后续切 PG：替换 `db/connection.js`，重写迁移文件

## 与扩展的协议约定

扩展上报的 `items` 数组每条形如：

```json
{
  "ts": 1778299XXX,
  "kind": "xhr",
  "url": "/visage-agent-seller/product/skc/pageQuery",
  "method": "POST",
  "status": 200,
  "site": "agentseller",
  "page": "/goods/list",
  "mall_id": "634XXXXX",
  "mall_name": "...",
  "tab_id": 12,
  "body": { ...response.json... },
  "bodySize": 12345,
  "captured_at": 1778299XXX
}
```

请求头：`Authorization: Bearer <jwt>` + `X-Device-Id: <uuid>`

## M3 计划

- [ ] 配置可在云端编辑（`/api/hook/v1/config` 改成读 DB）
- [ ] 任务下发：`/api/sync/cursor` 让扩展知道哪个店缺哪些数据，主动调用补抓
- [ ] WebSocket 实时下行（任务下发 + 数据刷新通知）
- [ ] 简单 web 控制台（React）
- [ ] 切 PG，capture_events 按月分区
