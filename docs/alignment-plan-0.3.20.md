# master vs goofy-wing 合并执行计划 (0.3.20)

生成日期：2026-05-20
作者：Claude (Plan agent) + Claude Opus 4.7
状态：待执行（委托 codex CLI）

## 重要前置纠正

`local master` 比 `origin/master` 落后 4 个 commit（缺 PR #2 worker-server + PR #10 1688 paid 等）。**所有命令以 `origin/master` 为 master 准星**。

- `local master = cfb61b9`
- `origin/master = 6d1ee29`（PR #2 merge 后）
- `claude/goofy-wing-cec9e0 = f7800b8`（含 0.3.19，已发到生产）
- merge-base = `2daf49b chore(release): 0.2.24`

## 三大关键事实（决定取舍方向）

1. **生产 `/opt/temu-cloud/` 实际跑 master 那一套**（SHA 对比验证），只额外手动复制了 goofy 的 `db/migrations/005_temu_sales.sql` 和 `scripts/verify-temu-sales.mjs` 两个文件。生产没有 git 仓库，是裸文件部署。
2. **生产 `/opt/temu-ext/temu-monitor.crx` 是 v0.3.8**（master 仓库 0.3.7、goofy 0.4.0）。是 5-19 11:25 UTC 本地手工迭代版。**生产 manifest 的 `key` 字段保留**（扩展 ID 锁死 `ejheeafceahglndenffjkcmojpiomcpg`）。
3. PR #2 worker-server-bootstrap 已合 master，**抽出了 `automation/worker-server.mjs`**。goofy 没经过这一抽离，goofy 在 worker.mjs 原地堆了 5-20 改动。

## 第一节：cloud/ 取舍

| 文件 | 决策 | 理由 |
|---|---|---|
| `cloud/README.md` | 取 master | 生产实际跑 master 版 |
| `cloud/parsers.js` | 取 master + 手 cherry temu_sales parser | 必须保留 005_temu_sales.sql 配套 |
| `cloud/routes/dashboard.js` | 取 master + append goofy 的 `/temu-sales` 路由 23 行 | temu_sales 路由是 goofy 唯一增量 |
| `cloud/db/migrations/005_temu_sales.sql` | 取 goofy | 生产已部署 |
| `cloud/scripts/verify-temu-sales.mjs` | 取 goofy | 生产已部署 |
| 其他 cloud/* | 取 master | 生产现役 |

## 第二节：extension/ 取舍

| 文件 | 决策 | 关键理由 |
|---|---|---|
| `extension/manifest.json` | 取 master 为底，版本号改 0.3.20 | **必须保留 `key` 字段** → 锁死扩展 ID。host_permissions 加 goofy 的 erp321/jushuitan/scm121 |
| `extension/web/background/hook-config.js` | 取 master + append goofy 的聚水潭 endpoint | master 218 endpoints 已稳定 |
| `extension/web/background/sw.js` | 取 master | 生产 CRX 是 master 版 |
| `extension/web/content/_config.generated.js` | rebuild 生成 | 跑 `node extension/scripts/build-bridge.cjs` |
| `extension/web/content/bridge.js` | 取 master | 生产 CRX 是 master 版 |
| `extension/web/options/*` `popup/*` | 取 master | 生产 CRX 是 master 版 |
| `extension/web/page/hook.js` | 取 master | 配生产兼容 |

## 第三节：content 冲突逐文件方案

### 简单

| 文件 | 方案 |
|---|---|
| `.gitignore` | 两边并集 |
| `src/App.tsx` | master + 加 jushuitan-import 重定向 1 行 |
| `scripts/test-desktop-regression.cjs` | 两边 smoke case 并集 |
| `deploy/static-update-site/{README.md,index.html}` | 取 goofy（5-20 重写） |

### 中等

| 文件 | 方案 |
|---|---|
| `package.json` | master 骨架 + (1) version 改 `0.3.20`，(2) 加 goofy 的 publish:update:* 三个脚本，(3) 删 normalize:update-yml，(4) **保留 master 的 `pack:ext`、保留 master 的 `publish[provider]`**（关键），(5) differentialPackage 取 goofy，adm-zip 提到 deps |
| `package-lock.json` | 不手合：`rm` 后 `npm install` 重新生成 |
| `src/components/Layout/AppLayout.tsx` | 取 goofy 的"出库中心"命名（ExportOutlined）；菜单取并集 |
| `src/utils/appSettings.ts` | 手合：master proxy + goofy 扩展安装 storeUrl/packageUrl |
| `src/styles/global.css` | 两边追加段并集 |
| `src/components/StoreManager.tsx` | 取 goofy（含 purchase1688Accounts 选择器） |
| `src/pages/Settings.tsx` | 取 goofy（简化版） |

### 复杂

| 文件 | 方案 |
|---|---|
| `electron/main.cjs` | master 为底 + **不取 goofy 的回滚**。**红线：保留 `DEFAULT_UPDATE_FEED_URL / UPDATE_SETTINGS_KEY / UPDATE_UPDATER_SESSION_PARTITION` 三常量** |
| `electron/erp/ipc.cjs` | master + cherry-pick goofy 7 段：(1) normalizeLimit 上限 500→10000，(2) listAccounts 加 includeJushuitanRawAccounts 过滤，(3) listSkus 加 search + excludeJst，(4) get1688DeliveryAddress 兼容 account_id 空 + ORDER BY case-when，(5) getPurchaseWorkbench jst:account:default 兜底，(6) to1688DeliveryAddress 加 purchase1688AccountId，(7) build1688AddressParamFromRow 拆 province/city/area |
| `electron/erp/lanServer.cjs` | master + 取 goofy 整段 `/releases/*` 静态路由 + CORS header |
| `automation/worker.mjs` | master（含 PR #2 worker-server 抽离）为底，goofy 5-20 改：(a) 删 probe_create_flow + capture_add_payload 两个 case，(b) auto_image_swap_openapi / openapi_call 用 `?.` 安全访问 + 返回字段改写。**保留 master 的 createWorkerServer/createWorkerAuthToken 抽离形态** |
| `src/pages/PurchaseCenter.tsx` | **取 goofy 整文件**（2478 行 diff）。**前提：必须先把 ipc.cjs 7 段补齐**，否则 tsc/runtime 缺字段 |

## 第四节：执行步骤（命令级）

### 阶段 A：准备（约 5 min）

已由 Claude 完成：起新分支 `merge/master-goofy-0.3.20` 基于 `origin/master`，新 worktree `C:\Users\Administrator\Desktop\temu-automation-merge`。

### 阶段 B：起步 merge -X ours（约 5 min）

```bash
cd C:/Users/Administrator/Desktop/temu-automation-merge
git merge --no-commit --no-ff -X ours claude/goofy-wing-cec9e0
# 所有冲突自动按 master 解决；非冲突新增文件自动入栈
```

### 阶段 C：cloud/ 收尾（约 10 min）

```bash
git checkout claude/goofy-wing-cec9e0 -- \
  cloud/db/migrations/005_temu_sales.sql \
  cloud/scripts/verify-temu-sales.mjs

# dashboard.js 手动 append /temu-sales 路由（从 goofy 版底部段）
# parsers.js 手动加 temu_sales parser（查 diff 找）
```

### 阶段 D：extension/ 收尾（约 20 min）

```bash
# manifest.json：master 版基础上手改
#   - version: → "0.3.20"
#   - host_permissions：插入 erp321/jushuitan/scm121
#   - content_scripts[].matches：同上插入
#   - 保留 "key" 字段（红线）
#   - 不接 all_frames: true

# hook-config.js：master + goofy 的聚水潭 endpoint 段

# 重新生成 _config.generated.js
node extension/scripts/build-bridge.cjs

# 重新签 CRX
node extension/scripts/pack-crx.cjs
# 验证 CRX manifest 还有 key 字段 + version=0.3.20
```

### 阶段 E：content 冲突逐文件（约 4-6 h）

按依赖顺序：

1. `.gitignore` — 5 min — master + goofy 末尾 5 行
2. `package.json` — 15 min — Edit 改版本号/scripts/deps
3. `package-lock.json` — 5 min — rm + npm install
4. `src/App.tsx` — 2 min — master + jushuitan-import 重定向 1 行
5. `electron/erp/lanServer.cjs` — 15 min — master + goofy 整段 /releases/* + CORS
6. `electron/erp/ipc.cjs` — 60-90 min — master + cherry-pick goofy 7 段（**最碎**）
7. `src/components/StoreManager.tsx` — 30 min — goofy 整文件覆盖 + 类型回补
8. `src/pages/PurchaseCenter.tsx` — 60 min — goofy 整文件覆盖（**依赖 ipc.cjs 先到位**）
9. `src/pages/Settings.tsx` — 15 min — goofy 整文件覆盖
10. `src/components/Layout/AppLayout.tsx` — 10 min — 手合"出库中心"命名 + 菜单并集
11. `src/utils/appSettings.ts` — 15 min — 并集
12. `src/styles/global.css` — 10 min — 并集
13. `electron/main.cjs` — 60 min — master + goofy 非 updater 改动（**红线保 updater 三常量**）
14. `automation/worker.mjs` — 90-120 min — master（含 PR #2）+ goofy 5-20 改 openapi（**最难**）
15. `scripts/test-desktop-regression.cjs` — 20 min — 两边 smoke case 并集
16. `deploy/static-update-site/{index.html,README.md}` — 5 min — `git checkout claude/goofy-wing-cec9e0 -- ...`

### 阶段 F：commit + 自检

```bash
git add -A
git diff --cached --stat | head -50
git commit -m "merge: 合并 claude/goofy-wing 进 master 收敛 0.3.20"

npm run lint:tsc           # 必须 0 错
npm run build              # 必须 success
npm run smoke:desktop      # 必须 PASS
```

## 第五节：风险红线

1. **`extension/manifest.json` 的 `"key"` 字段绝不能删** → 删了所有客户机器扩展会被 Chrome 视为不同扩展而禁用
2. **`electron/main.cjs` updater 三常量绝不能回滚到 0.2.x 形态**：`DEFAULT_UPDATE_FEED_URL` / `UPDATE_SETTINGS_KEY` / `UPDATE_UPDATER_SESSION_PARTITION`
3. **`PurchaseCenter.tsx` 必须等 `ipc.cjs` 7 段全到位后才能取 goofy 整文件**
4. **`package.json` 的 `publish[provider]` 段绝不能删** → electron-builder 不再生成 latest.yml
5. **`worker.mjs` openapi 改写时漏 `?.` 写法** → runtime null deref

## 第六节：现役验证清单

```bash
# tsc + build
npm run lint:tsc
npm run build

# smoke
npm run smoke:desktop

# 扩展 CRX 校验（关键）
node extension/scripts/pack-crx.cjs
# 解开 CRX 验证：manifest 还有 key 字段 + version=0.3.20

# cloud/ vs 生产 diff
ssh temu-erp 'cd /opt/temu-cloud && for f in routes/dashboard.js parsers.js scripts/verify-temu-sales.mjs db/migrations/005_temu_sales.sql; do echo "--- $f ---"; sha256sum $f; done'
for f in routes/dashboard.js parsers.js scripts/verify-temu-sales.mjs db/migrations/005_temu_sales.sql; do git show HEAD:cloud/$f | tr -d "\r" | sha256sum; done

# 本地启 ERP server / cloud / electron dev
npm run erp:server  # http://localhost:19380/health
cd cloud && node server.js  # http://localhost:8788/console/
npm run dev
```

## 第七节：发版策略

**短期推荐：不发版，先 PR review**。

- D+0：合并 commit，本地 dev box 跑满 1 天
- D+1：开 PR、push GitHub；本地构建 NSIS 不上 erp.temu.chat
- D+2：内部 1 台测试机装 0.3.20，跑全套
- D+3：升 /opt/temu-cloud/（确认 git 一致），systemctl restart temu-cloud
- D+4：升 /opt/temu-ext/temu-monitor.crx → 0.3.20，先看一台客户机器 ID 未变
- D+5：升桌面端，走 `npm run publish:update:erp`

**回滚预案**：
- 桌面端：保留 0.3.19 安装包；differentialPackage 可降级
- 扩展：`/opt/temu-ext/temu-monitor.crx.bak-0.3.8` 备份
- cloud：服务器 `/opt/temu-cloud/data/` 已有 bak 目录

## 关键文件清单

合并时优先确认这些文件状态：

- `electron/erp/ipc.cjs`（7 段手 cherry-pick，最碎）
- `automation/worker.mjs`（PR #2 抽离 + goofy 5-20 openapi 改写）
- `extension/manifest.json`（key 字段 / 扩展 ID 锁死，发版安全红线）
- `electron/main.cjs`（updater 配置防回滚）
- `src/pages/PurchaseCenter.tsx`（goofy 整文件覆盖，依赖 ipc.cjs 字段先到位）
