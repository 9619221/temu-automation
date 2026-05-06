# 多 1688 采购账号 + 推单账号选择（feature spec）

## 业务诉求

当前一个公司（company）只能配一组 1688 OAuth 凭据（`erp_1688_auth_settings` 单行），所有 Temu 店铺共用。
要支持：
- 同一 company 内绑定多个 1688 买家账号
- 每个 Temu 店铺可指定默认 1688 采购账号
- 推单时优先用店铺默认；多账号且无默认时弹 Modal 让用户选

UX 模式参照 `PurchaseCenter.tsx` 现有「推单前选 1688 收货地址」的 Modal（[PurchaseCenter.tsx:2829-2849](../src/pages/PurchaseCenter.tsx)）：
- 0 个候选 → 直接报错
- 1 个候选 → 直接用，不弹
- 多个有默认 → 直接用默认，不弹
- 多个无默认 → 弹 Modal 让用户选

## 已完成

### Migration 026 ✅

[electron/db/migrations/026_1688_purchase_accounts.sql](../../electron/db/migrations/026_1688_purchase_accounts.sql)：

- `erp_1688_auth_settings` 加两列：`label TEXT`（账号别名）、`status TEXT DEFAULT 'active'`（启用/禁用）
- `erp_accounts` 加一列：`default_1688_purchase_account_id TEXT`（Temu 店铺关联的默认 1688 采购账号 ID）
- 新增两个索引

migration 是**纯增量、向后兼容**的——已部署的主控端 git pull 后 dev 启动自动跑 migration，不影响现有功能。

## 剩余工作清单（按依赖顺序）

### 1. 主控端 IPC：1688 采购账号 CRUD

**位置**：`electron/erp/ipc.cjs`

新增 action（在 `BROADCAST_PURCHASE_ACTIONS` 列表 + action handler 里）：

| action | 入参 | 出参 | 说明 |
|---|---|---|---|
| `list_1688_purchase_accounts` | `{ companyId? }` | `{ accounts: [{id, label, memberId, status, accessTokenExpiresAt, configured, authorized, ...}] }` | 列出当前 company 所有 1688 凭据；不返 access_token / refresh_token |
| `delete_1688_purchase_account` | `{ id }` | `{ ok }` | 删某条；前置检查：被任意 Temu 店铺当作 default_1688_purchase_account_id 时拒绝并返回占用列表 |
| `set_default_1688_purchase_account` | `{ accountId, default1688AccountId? }` | `{ ok }` | 给 Temu 店铺设默认；`default1688AccountId=null` 表示清空默认 |
| `update_1688_purchase_account_label` | `{ id, label, status? }` | `{ ok }` | 改账号别名 / 启用禁用 |

权限：admin / manager 可写；buyer 可读 list（用于推单 Modal 显示）。

### 2. OAuth 流程改造

**位置**：`electron/erp/ipc.cjs` 的 `start_1688_oauth` / `complete_1688_oauth` 两个 action 处理函数。

当前：每个 company 只有一行，OAuth 完成后 update 那一行。
目标：

- `start_1688_oauth` 入参增加 `mode: "new" | "update"`、`accountId?`（mode=update 时必填指定要更新哪个账号）
- `complete_1688_oauth`：
  - mode=new → INSERT 一条新 `erp_1688_auth_settings`，`label` 默认为 `member_id`
  - mode=update → 走原来 update 逻辑（按 accountId 定位行）
- 默认行为兼容：不传 mode 当作 update（兼容旧 web UI）

`scripts/configure-1688-auth.cjs` 也要支持新建模式（加 `--new` flag 或环境变量 `ERP_1688_LABEL`）。

### 3. push_1688_order / preview_1688_order 接受 purchase1688AccountId

**位置**：`electron/erp/ipc.cjs` 的 `push1688OrderAction` / `preview1688OrderAction`，及 `call1688ProcurementApi`

当前：`call1688ProcurementApi` 内部按 `accountId`（Temu 账号）去查 `getPurchaseAccountById1688Token` 拿 access_token，背后是 `get1688AuthRow(companyId)` 取 company 默认。

改：

- payload 增加 `purchase1688AccountId?`
- 优先级：`payload.purchase1688AccountId` > Temu 店铺 `default_1688_purchase_account_id` > company 第一行兜底
- `call1688ProcurementApi` 改成接受 `purchase1688AccountId` 直接定位行
- 返回错误时把"用的是哪个 1688 账号"也透传给前端，方便排错

### 4. 主控端 web UI（lanServer.cjs）

**位置**：`electron/erp/lanServer.cjs` 的 `render1688AuthPage`（line 1474）

当前：单账号表单（AppKey/Secret/redirectUri/Token + 「去 1688 授权」「刷新 Token」）。

改成账号列表：

```
┌─ 1688 采购账号 ───────────────────────────────────┐
│ [+ 新增账号]                                       │
│                                                   │
│ chenjialin202 (active)         [编辑] [刷新] [删除] │
│   AppKey: 4607218                                 │
│   到期: 2026-06-15                                │
│                                                   │
│ another_user (active)          [编辑] [刷新] [删除] │
│   AppKey: 4607219                                 │
│   到期: 2026-07-20                                │
└──────────────────────────────────────────────────┘
```

每个账号一张 card，操作按钮直接走对应 IPC。新增按钮 → 弹表单 → 填 AppKey/Secret + label → 走 OAuth flow（mode=new）。

### 5. 客户端：preload + electron.d.ts

**位置**：`electron/preload.cjs`、`src/types/electron.d.ts`

加 namespace：

```ts
erp.purchase1688Account = {
  list: (params?) => Promise<{ accounts: Account[] }>,
  delete: (id: string) => Promise<{ ok: true }>,
  updateLabel: (payload) => Promise<{ ok: true }>,
};
erp.account.setDefault1688PurchaseAccount = (accountId, default1688AccountId | null) => Promise<{ ok }>;
```

不需要在客户端做 OAuth 流程的 IPC——admin 用户继续走主控端 web UI 完成 OAuth（避开浏览器 redirect_uri 跨进程协调）。

### 6. StoreManager.tsx：每店铺加默认 1688 账号下拉

**位置**：`src/components/StoreManager.tsx`

- `loadAll` 里同时拉 1688 采购账号列表（`erp.purchase1688Account.list()`）
- 每个 Temu 店铺行加一列「默认 1688 采购账号」 → 下拉从 1688 账号列表选 → 选完调 `erp.account.setDefault1688PurchaseAccount`
- 候选为空时下拉禁用 + 链接「→ 去管理 1688 账号」（点开后跳「设置 → 1688 授权管理」）

### 7. PurchaseCenter.tsx：推单按钮加账号选择

**位置**：`src/pages/PurchaseCenter.tsx` 的 `push1688Order` / `requestPush1688Order`（line 2790~2849）

参照现有「1688 收货地址」选择模式（[PurchaseCenter.tsx:2829-2849](../src/pages/PurchaseCenter.tsx)）：

```ts
const accounts = await erp.purchase1688Account.list();
const activeAccounts = accounts.filter(a => a.status === "active" && a.configured && a.authorized);
const storeDefault = sku.account?.default1688PurchaseAccountId;

if (activeAccounts.length === 0) {
  message.error("当前 company 还没有可用的 1688 采购账号，请到「设置 → 1688 授权管理」绑定");
  return;
}
if (activeAccounts.length === 1) {
  return push1688Order(row, { purchase1688AccountId: activeAccounts[0].id });
}
if (storeDefault && activeAccounts.find(a => a.id === storeDefault)) {
  return push1688Order(row, { purchase1688AccountId: storeDefault });
}
// 弹 Modal 让用户选
setPurchase1688AccountSelectionDialog({ row, accounts: activeAccounts });
```

新增 Modal 组件：行 + radio 选 + 「下次仍弹询问」复选框（如果勾上"以后这家店都用这个"，提交时同时调 setDefault1688PurchaseAccount）

### 8. 测试场景

- **单账号场景**：原行为不变（推单不弹 Modal）
- **多账号 + 店铺有默认**：推单不弹，按默认走
- **多账号 + 店铺无默认**：推单弹 Modal，可选 + 可勾"作为店铺默认"
- **删账号**：被店铺占用为默认时拒绝；非占用时删成功，已下推单的 PO 不受影响
- **修改 access_token**：新 token 立即生效（缓存层若有要 invalidate）

## 部署 / 发版步骤

1. 主控端先合并 + 部署：`git pull origin master` + `node electron/db/migrate.cjs`（自动跑 026） + `pm2 restart erp-server`
2. 客户端打 0.2.8 release：`npm run dist:win` + `gh release create v0.2.8 ...`
3. 用户客户端自动检查更新装 0.2.8

**主控端 web UI 一旦可用，admin 就能加新账号——但客户端 0.2.8 之前的版本不会用新账号字段**（继续用 company 第一行兜底）。所以发版顺序无所谓，先后都不会破坏数据。

## 工作量估算

| 模块 | 工时 |
|---|---|
| 1. 主控端 IPC CRUD | 2h |
| 2. OAuth 流程改造 | 1h |
| 3. push/preview 路由账号 | 1h |
| 4. 主控端 web UI 列表化 | 1.5h |
| 5. preload + types | 0.3h |
| 6. StoreManager 下拉 | 0.5h |
| 7. PurchaseCenter Modal | 1h |
| 8. 测试 + update guide + 发版 | 0.7h |
| **合计** | **~8h** |

## 下次会话开局指令

> 做 `docs/plans/2026-05-06-multi-1688-purchase-accounts.md` 这份计划。已完成 migration 026，从「剩余工作清单第 1 步」继续。

我会按 1 → 8 顺序推进，每完成一个独立可 commit 的阶段就提交一次。
