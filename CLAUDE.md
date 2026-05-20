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

# 发版流程 / Release Workflow

**事实主干 = `master`。所有功能 commit 必须先合 master，再发版。禁止旁支独立 commit 功能后直接发版。**

## 背景

历史上 `goofy-wing-cec9e0` 长期作发版分支，跟 master 平行演化、积累过 26 个独有 commit，导致：

- 0.3.13 / 0.3.14 / 0.3.15 / 0.3.16 / 0.3.17 / 0.3.18 / 0.3.19 七个版本发自旁支，git 主线（master）一段时间内不含这些代码
- 服务器 `/opt/temu-automation/` 跟 git 仓库分叉
- 5-20 整理时不得不开 [PR #11](https://github.com/9619221/temu-automation/pull/11) 做 master ←→ goofy-wing 大对齐

为防止再次累积分叉，定下面规则。

## 发版前必做

1. 主仓 worktree（`C:\Users\Administrator\Desktop\temu-automation`）切到 `master`
2. `git fetch origin && git reset --hard origin/master`（让本地 master 跟远端完全同步）
3. **如果用 `goofy-wing-cec9e0` 作为发版临时分支**：必须先 `git reset --hard origin/master` 让它 == master，**禁止在 goofy-wing 上直接 commit 功能代码**
4. 跑 `npx tsc --noEmit` 验证 0 错
5. 跑 `npm run dist:win` 打 NSIS 安装包
6. 跑 `npm run publish:update:erp` 推自建服务器（推 GitHub Releases 用 `publish:update:github`）
7. 验证 `https://erp.temu.chat/releases/latest.yml` 显示新版本号

## 版本号 bump 在哪做

- `package.json` 的 `version` bump **必须在 master 上 commit**，不在旁支
- bump commit message 格式：`chore(release): bump 0.3.X` + 一行 release note
- bump 后立即 push origin master

## 功能改动怎么进 master

- 所有 feature / fix 走 PR：claude/* 或 codex/* 分支 → PR → review → 合 master
- master 是唯一 base，**禁止 PR base 在 goofy-wing 或其他长期分支**
- 紧急 hotfix 也是同流程（cherry-pick PR 直接 fast-track 合 master 后立即发版）

## 服务器代码同步

erp.temu.chat 服务器 `/opt/temu-automation/` 是裸文件部署，跟 git 历史分叉。规则：

- **绝不 `git pull` 服务器代码**（会冲突损坏救火 patch）
- 同步代码用外科补丁：`scp` 替换具体文件 → `node -c` 语法校验 → `systemctl restart temu-erp.service`
- 同步前必须 sqlite snapshot 保命：`node -e "require('better-sqlite3')(...).backup('...PRE-XXX-时间戳')"`
- 服务器侧也要保持跟 master 同步的目标，逐渐让服务器代码 == master HEAD（长期改造，单独立项）

## 应急回滚

- 桌面端：`erp.temu.chat/releases/` 保留全部历史版本 .exe + blockmap。改 `latest.yml` 回滚到旧版本号即可
- 服务器代码：每次 patch 前 `cp xxx.cjs xxx.cjs.bak-pre-XXX` 留底，回滚 `cp` 回去 + `systemctl restart`
- 数据库：`/opt/temu-erp-data/erp.sqlite.PRE-*` 系列快照
