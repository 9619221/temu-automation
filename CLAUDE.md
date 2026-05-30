# Language / 语言约定

**Always respond in Simplified Chinese (简体中文).**

所有输出一律使用简体中文，包括但不限于：

- 对话回复、解释、问答
- Git commit message
- Pull Request 标题与描述
- 代码注释（新增或修改的部分）
- 文档（README、docs/、markdown 文件正文）
- 错误说明、调试信息、总结报告

即使用户用英文、法文或其他语言提问，也必须用简体中文回复。

## 例外：保持英文的部分

- 代码本身：变量名、函数名、类名、文件名、API 标识符、配置键名
- 第三方命令、库名、错误码原文（可在其后用中文补充解释）
- 技术术语的通用英文缩写（如 API、HTTP、CI/CD）可直接使用

## 风格要求

- 语气简洁、技术性，避免口语化和过度客套
- 不使用 emoji（除非用户明确要求）
- 专有名词首次出现时可用「中文（English）」形式标注

# 操作边界 / Action Boundary

没有用户明确说出对应动作时，助手只允许做代码修改和本地验证，不得主动执行提交、推送、打包、发版或更新服务器。

- 只有用户明确说「提交 / commit」时，才可以创建 git commit
- 只有用户明确说「push / 推送」时，才可以推送到远端仓库
- 只有用户明确说「打包 / 发安装包 / 发版 / 更新服务器 / 上传安装包」时，才可以构建安装包、发布更新源或同步服务器
- 用户只说「改一下 / 看看 / 感觉不习惯 / 优化一下」时，默认只改本地代码并做本地验证，等待用户确认下一步

# 发版流程 / Release Workflow

**事实主干 = `master`。所有功能 commit 必须先合 master，再发版。禁止旁支独立 commit 功能后直接发版。**

## 日常开发分支策略

- **功能 / fix 一律在 `claude/*`（或 `codex/*`）短分支上开发**，改完及时 commit，再 push 开 PR 合 master。**不要把改动长期停在 master 工作区「未提交」状态**——未提交改动随时可能被 IDE「撤销更改」或 `git checkout` 刷回 HEAD（踩过：移走的入口反复自己冒回来，根因就是改动一直没提交）。
- **dev 跑在哪个分支无所谓**：`npm run dev` 只服务当前工作区代码，切到哪个分支就跑哪个分支。分支模型管的是「提交往哪落」，不是「dev 在哪跑」。
- master 只接两类写入：① PR 合并；② 版本号 bump（见下）。其它一切功能改动都先进 `claude/*` 分支。

## 背景

历史上 `goofy-wing-cec9e0` 长期作发版分支，跟 master 平行演化、积累过 26 个独有 commit，导致：

- 0.3.13 / 0.3.14 / 0.3.15 / 0.3.16 / 0.3.17 / 0.3.18 / 0.3.19 七个版本发自旁支，git 主线（master）一段时间内不含这些代码
- 服务器 `/opt/temu-automation/` 跟 git 仓库分叉
- 5-20 整理时不得不开 [PR #11](https://github.com/9619221/temu-automation/pull/11) 做 master ←→ goofy-wing 大对齐

为防止再次累积分叉，定下面规则。

## 发版必做

发版永远从 master 发，不从旁支。口诀：**对齐 master → tsc → bump+push → dist:win → 推 erp + 推 github → 验 latest.yml → 同步服务器主控端**。

1. 功能改动已通过 PR 合进 master（前提：见「日常开发分支策略」）
2. 主仓 worktree（`C:\Users\Administrator\Desktop\temu-automation`）切到 `master`
3. `git fetch origin && git reset --hard origin/master`（让本地 master 跟远端完全同步）
4. 跑 `npx tsc --noEmit` 验证 0 错
5. **bump 版本号**：改 `package.json` 的 `version`，commit `chore(release): bump 0.3.X` + 一行 release note，`git push origin master`。version 决定安装包版本号，**必须在打包前 bump**（详见下「版本号 bump 在哪做」）
6. 跑 `npm run dist:win` 打 NSIS 安装包
7. **发布更新源——两个都要推**：`npm run publish:update:erp`（自建服务器 `latest.yml`）+ `npm run publish:update:github`（GitHub Releases）。⚠️ exe 下载是 302 跳 GitHub，**`publish:update:github` 不可省略**，只推 erp 用户下不到包；两边发布有竞态，别并发乱推
8. 验证 `https://erp.temu.chat/releases/latest.yml` 显示新版本号
9. **同步服务器代码到 master**（见下「服务器代码同步」节）—— 桌面端用户更新到新版后，前端会调用新 action / 用到新字段，**主控端必须同时跟上**，否则用户会撞 `Unsupported purchase action: xxx` 或 `no such column: xxx` 一类错。这一步**不可省略**。

## 版本号 bump 在哪做

- `package.json` 的 `version` bump **必须在 master 上 commit**，不在旁支
- bump commit message 格式：`chore(release): bump 0.3.X` + 一行 release note
- bump 后立即 push origin master

## 功能改动怎么进 master

- 所有 feature / fix 走 PR：claude/* 或 codex/* 分支 → PR → review → 合 master
- master 是唯一 base，**禁止 PR base 在 goofy-wing 或其他长期分支**
- 紧急 hotfix 也是同流程（cherry-pick PR 直接 fast-track 合 master 后立即发版）

## 服务器代码同步

erp.temu.chat 服务器 `/opt/temu-automation/` 是裸文件部署，跟 git 历史分叉。每次桌面端发版（步骤 8 验证通过）后**立即同步**，规则：

### 同步范围

服务器 ERP 服务（`temu-erp.service`，`npm run erp:server` 拉起）只用以下运行时文件，桌面端 UI 文件不用同步：

- `electron/erp/ipc.cjs`（主控端入口，最大头）
- `electron/erp/workflow/*.cjs`（transitions / validators / enums）
- `electron/erp/services/*.cjs`（purchase / inventory / outbound / jushuitan 等）
- `electron/erp/*.cjs` 其他被 ipc.cjs `require` 的（1688Client / lanServer / mappingCache / jushuitanClient 等）
- `electron/db/migrate.cjs`（迁移引擎本身）
- `electron/db/migrations/*.sql`（新增的 migration 文件）
- `scripts/erp-server.cjs`

`src/`、`automation/worker.mjs`、`electron/main.cjs` 等是桌面端 Electron 进程独享的，**不要**同步到服务器。

### 同步步骤（每次发版后跑一次）

1. **检查磁盘空间**：`ssh temu-erp "df -h /opt"` —— 至少留 3.5 GB，否则 migrate.cjs 启动时 backup sqlite 到 `/opt/backups/` 会撞 ENOSPC，服务进 restart loop（坑过一次）。不够就先 `sudo rm /opt/backups/erp-<旧日期>.sqlite` 释放
2. **本地 LF normalize**：服务器是 Linux，但本地很多 cjs 是 CRLF。先 `node -e "fs.writeFileSync(out, fs.readFileSync(src).toString().replace(/\r\n/g,'\n'))"` 转 LF 再传
3. **服务器侧备份现役文件**：`cp -av /opt/temu-automation/electron/erp/ipc.cjs ipc.cjs.bak-pre-<feature>-<时间戳>`，多个文件每个都备份
4. **sqlite 快照**：`cd /opt/temu-automation && node -e "require('better-sqlite3')('/opt/temu-erp-data/erp.sqlite').backup('/opt/temu-erp-data/erp.sqlite.PRE-<feature>-<时间戳>').then(()=>console.log('OK'))"`
5. **scp 上传 + mv 覆盖 + chown ubuntu:ubuntu**：先扔到 `/tmp/`，`node -c` 语法校验后再 mv 到位
6. **scp 新增 migration**：先 `ls /opt/temu-automation/electron/db/migrations/` 跟本地对，**只传缺的**；服务器已跑过的同语义 migration 可能是旧编号（如服务器 `027_jushuitan_sync` ↔ master `030_jushuitan_sync`），不要瞎覆盖
7. **重启服务**：`sudo systemctl restart temu-erp.service`，`sleep 8`，`systemctl is-active` + `journalctl -u temu-erp.service --since '1 minute ago' --no-pager` 看 `[ERP Server] migrations: ...:success` 全跑过 + `[ERP Server] listening:` 出来
8. **快速验证**：`curl -sk -o /dev/null -w '%{http_code}\n' https://erp.temu.chat/` 应该 302；`grep -c <新action名> /opt/temu-automation/electron/erp/ipc.cjs` 确认 marker 在

### 死规则

- **绝不 `git pull` 服务器代码**（会冲突损坏救火 patch）
- **所有 `ALTER TABLE ... ADD COLUMN` migration 必须带 `-- @idempotent`**（[db_migration_conventions](#) 已写）。服务器历史有人手加过列但 migration_log 不知道，没 @idempotent 会撞 `duplicate column name` 让 migrate.cjs 整体抛错、服务起不来
- **migrate.cjs 本身的版本要先于 SQL 文件同步**：服务器旧版 migrate.cjs 不认 `@idempotent` 注释（坑过一次）。新加 idempotent SQL 之前，先确保 `grep -c idempotent /opt/temu-automation/electron/db/migrate.cjs` ≥ 1
- 服务器侧也要保持跟 master 同步的目标，逐渐让服务器代码 == master HEAD（长期改造，单独立项）

## 应急回滚

- 桌面端：`erp.temu.chat/releases/` 保留全部历史版本 .exe + blockmap。改 `latest.yml` 回滚到旧版本号即可
- 服务器代码：每次 patch 前 `cp xxx.cjs xxx.cjs.bak-pre-XXX` 留底，回滚 `cp` 回去 + `systemctl restart`
- 数据库：`/opt/temu-erp-data/erp.sqlite.PRE-*` 系列快照
