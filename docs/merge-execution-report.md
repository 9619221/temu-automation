# merge/master-goofy-0.3.20 合并执行报告

执行日期：2026-05-20

目标：将 `claude/goofy-wing-cec9e0` (`f7800b8`) 合并到 `merge/master-goofy-0.3.20`，以 `origin/master` (`6d1ee29`) 为 master 准星。

## 已完成内容

- 按 Phase B 执行 `git merge --no-commit --no-ff -X ours claude/goofy-wing-cec9e0`，并提交初始 merge 基线。
- `cloud/` 保留 master 基线，补入 `005_temu_sales.sql`、`verify-temu-sales.mjs`、`temu_sales_snapshot` parser 和 `/temu-sales` dashboard route。
- `extension/` 保留 manifest `key`，版本改为 `0.3.20`，加入 `erp321/jushuitan/scm121` 权限与 hook 白名单，重新生成 `_config.generated.js`，并成功打包 CRX。
- `package.json` 调整到 `0.3.20`，加入 `publish:update:*` 脚本但未执行，保留 `pack:ext` 和 `build.publish[0].provider = generic`，`adm-zip` 移入 dependencies，重新生成 `package-lock.json`。
- `electron/erp/ipc.cjs` 先补齐计划中的 7 段采购兼容逻辑，然后才采用 goofy 的 `PurchaseCenter.tsx`。
- `StoreManager.tsx`、`PurchaseCenter.tsx`、`Settings.tsx` 按计划采用 goofy 版本。
- `electron/main.cjs` 保留 master updater 基线和三常量：`DEFAULT_UPDATE_FEED_URL`、`UPDATE_SETTINGS_KEY`、`UPDATE_UPDATER_SESSION_PARTITION`。
- `automation/worker.mjs` 保留 PR #2 的 `createWorkerServer/createWorkerAuthToken` 抽离形态，移除 `probe_create_flow` / `capture_add_payload`，合入 OpenAPI handler 的安全访问与返回字段改写。
- `scripts/test-desktop-regression.cjs` 保留 master 的采购流检查，并合入 goofy 的出库中心标题与侧栏等待选择器。
- `deploy/static-update-site/README.md`、`index.html` 采用 goofy 版本。

## 手工决策

- `src/utils/appSettings.ts` 保留 master 的 `updateProxyRules`，同时保留扩展安装链接字段，匹配计划的并集方向。
- `src/styles/global.css` 保留 master 的扩展安装 banner 样式，同时采用 goofy 的 guide 双栏宽度。
- `electron/main.cjs` 中自动更新行为回到 master 基线，避免引入 goofy 的 updater 形态变更。
- 为通过 `smoke:desktop`，按现有脚本要求补跑了 `npm run build:image-studio` 和 `npm run build:resources` 生成本地验证所需的 ignored 构建产物。

## TODO

无遗留 TODO。

## 验证结果

- `node extension/scripts/pack-crx.cjs`：PASS，version `0.3.20`，calculated id `ejheeafceahglndenffjkcmojpiomcpg`。
- `npx tsc --noEmit`：PASS，0 errors。
- `npm run build`：PASS。
- `npm run smoke:desktop`：PASS。

## 红线复核

- `extension/manifest.json` 保留 `"key"`。
- `electron/main.cjs` 保留 `DEFAULT_UPDATE_FEED_URL` / `UPDATE_SETTINGS_KEY` / `UPDATE_UPDATER_SESSION_PARTITION`。
- `package.json` 保留 `publish` 且 `provider: generic`。
- `PurchaseCenter.tsx` 在 `ipc.cjs` 7 段补齐并提交后才采用 goofy 版本。
- `automation/worker.mjs` 保留 `createWorkerServer / createWorkerAuthToken`。

## 提交记录

Phase F 验证通过时的代码提交：`2b34b64c5b23ec9386039c94f331bd9b8857427d`。
