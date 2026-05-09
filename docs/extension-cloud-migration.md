# Temu 多店监控扩展 + 云端 入仓说明

本文档说明 [`extension/`](../extension/) 和 [`cloud/`](../cloud/) 两个新顶层目录的来历、定位、与现有代码的边界，以及后续 C 方案的迁移路线。

## 目录定位

| 目录 | 类型 | 不会被打进桌面端 | 部署方式 |
|---|---|---|---|
| `extension/` | Chrome MV3 扩展（Temu 多店监控） | electron-builder `files` 白名单只含 `electron/`、`automation/`、`node_modules/`、`package.json`，扩展天然不入包 | 运营自己装到 Chrome（开发模式或商店包） |
| `cloud/` | Node + Express + better-sqlite3 服务 | 同上，独立部署 | 单独的服务器，反代 + HTTPS（参考 `cloud/deploy/`） |

## 与「现有 worker.mjs ext-feed」的边界

仓库里 [`automation/worker.mjs`](../automation/worker.mjs) 已存在一套以 `/ext-feed` 为入口的本地扩展上报机制（见 `pushExtFeed`、`extFeedBuffer` 等），那是**老路**：单机、localhost-only、JSON 落 `ext-feed.jsonl`、桌面端前端轮询消费。

新加的 `extension/` + `cloud/` 是**多店云端汇总**方向：

- 上报到云端 HTTPS endpoint（`POST /api/ingest/v1/batch` + JWT）
- N 家店设备并行写同一个 SQLite，按 `tenant_id` 隔离
- 云端有 dashboard 路由可查多维聚合（`/api/dashboard/stats`、`/timeline`、`/by-mall` 等）

两套**目前并存、互不影响**。C 方案的目标是用新路替代老路，但需要分阶段灰度，详见下文。

## 入仓做了哪些改动

- `extension/` ← 整目录从 `.claude/worktrees/sharp-feistel-4b78e7/extension/` 复制
- `cloud/` ← 同上，但排除运行时产物 `data/`（SQLite + WAL + 日志）和 `node_modules/`
- `src/pages/MultiStoreCloud.tsx` ← 桌面端「多店云监控」页面
- `src/utils/cloudClient.ts` ← 桌面端连云端 dashboard 的 fetch 客户端
- [`src/App.tsx`](../src/App.tsx) ← 注册 `/multi-store-cloud` 路由 + lazy import
- [`src/components/Layout/AppLayout.tsx`](../src/components/Layout/AppLayout.tsx) ← 「数据」菜单组下加「多店云监控」入口
- [`src/utils/erpRoleAccess.ts`](../src/utils/erpRoleAccess.ts) ← `/multi-store-cloud` 限制 `admin` / `manager`
- [`.gitignore`](../.gitignore) ← 排除 `cloud/data/`、`extension/_metadata/`

## 本地起服开发

```bash
cd cloud
npm install
cp .env.example .env   # 改 JWT_SECRET / PORT
npm run seed           # 创建 admin 用户（默认密码 changeme123）
npm run dev            # 起 server（默认 8788）
```

扩展加载：`chrome://extensions/` → 开发者模式 → 「加载已解压扩展」→ 选 `extension/` 目录。

详细使用见 [`extension/README.md`](../extension/README.md) 和 [`cloud/README.md`](../cloud/README.md)。

## C 方案后续阶段

| 阶段 | 范围 | 状态 |
|---|---|---|
| 1 | 基础设施入仓 + 接入菜单 | **本次完成** |
| 2 | 云端补 SKC 聚合 + mall 解析 + dashboard 路由扩展（纯加法） | 进行中 |
| 3 | PriceReview 加「云端预览」试读 tab（**不**替换本地） | 进行中 |
| 4 | 主要看板灰度切云端（双数据源开关） | 待启动（需扩展铺到 ≥3 店、跑稳定 ≥2 周） |
| 5 | 删除 `worker.mjs` Temu 采集分支（保留 1688 / ImageStudio / 价格巡检 / 竞品评论） | 阶段 4 完成后 |

阶段 4-5 启动前需满足：扩展铺到 ≥3 家店、连续 2 周心跳健康、`temu_raw_*` Electron Store 历史数据完整归档到云端 `legacy_dump`。
