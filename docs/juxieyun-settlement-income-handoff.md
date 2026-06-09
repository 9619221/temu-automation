# 聚协云结算数据采集接通交接

更新时间：2026-06-08

## 当前状态

已补齐「Temu 商家后台结算收入」从云端抓包到 ERP 多店报表的本地链路：

1. 云端 worker/扩展抓包写入 `cloud.capture_events`
2. ERP 同步任务读取 `/api/merchant/front/finance/income-summary`
3. ERP 同步任务也会读取三类结算明细接口：
   - `/api/merchant/settle/detail/full/wait-settlement`
   - `/api/merchant/settle/detail/full/in-settlement`
   - `/api/merchant/settle/detail/full/settled`
4. 收入汇总按 `mall_id + stat_date` 物化到 `erp_temu_settlement_income`
5. 结算明细按 `mall_id + site + settlement_status + stat_date + item_key` 物化到 `erp_temu_settlement_detail`
6. 多店报表展示「今日结算」「近 7 天结算」「近 30 天结算」和结算趋势

说明：Temu 官方 OpenAPI 当前没有直接可用的财务/结算开放接口，所以这条链路走商家后台接口抓包，不走官方 OpenAPI。
结算接口按店铺区分时依赖请求头 `mallid`，扩展会把该请求头透传成 `capture_events.mall_id`，否则 ERP 同步会过滤掉无法归店的数据。

## 接口来源与验真口径

这次接入的接口不是凭空猜的，也不是 Temu 官方 OpenAPI：

- `docs/openapi-datasource-mapping.md` 已记录过官方 OpenAPI 覆盖范围，其中「财务/结算/对账/回款」被标为官方无接口，需要保留抓包。
- `docs/temu-财务结算自研采集方案.md` 记录了前期实测结果：三态结算明细接口来自 Seller Central「账户资金→结算数据」页面，实测拿到过待处理、结算中、已到账金额字段。
- `extension/web/background/hook-config.js` / `extension/web/content/_config.generated.js` 是当前扩展抓包白名单，只有白名单内路径才会进入 `cloud.capture_events`。

当前轻量版使用的路径：

| 路径 | 来源 | 用途 |
|---|---|---|
| `/api/merchant/front/finance/income-summary` | 已有扩展抓包链路 | 日维度结算收入汇总 |
| `/api/merchant/settle/detail/full/wait-settlement` | 前期商家后台实测抓包 | 待处理款项 |
| `/api/merchant/settle/detail/full/in-settlement` | 前期商家后台实测抓包 | 结算中款项 |
| `/api/merchant/settle/detail/full/settled` | 前期商家后台实测抓包 | 已到账款项 |

上线验收不能只看代码里有这些字符串，必须以真实 cloud 库为准：

1. 扩展更新后，使用真实 Temu 登录态访问「账户资金→结算数据」页面。
2. 在 `cloud.capture_events` 中确认上述路径出现，且 `mall_id` 非空。
3. 再运行 `npm run check:erp:settlement -- --deep`，看到 `income_summary_present` 或 `settlement_detail_present`。
4. 最后运行同步脚本，把真实抓包物化到 ERP 表，再打开多店报表确认金额。

接口字段已做兼容兜底：

- 列表位置支持 `result`、`result.list`、`result.rows`、`result.items`、`data.result`、`data.list`、`data.rows` 等常见形态。
- 日期字段支持 `date`、`statDate`、`stat_date`、`dateStr`、`dataDate`、`day`、`settleDate`。
- 金额字段支持 `incomeAmount`、`amount`、`income`、`settleAmount`、`settlementAmount`；`incomeAmount.amount` 按“分”转“元”。
- 三类结算明细会额外保存原始行 JSON 和 `amounts_json`，方便后续拿到真实样本后继续校准字段名。

## 涉及文件

- `electron/db/migrations/081_temu_settlement_income.sql`
- `electron/db/migrations/082_temu_settlement_detail.sql`
- `electron/erp/services/multiStoreReport.cjs`
- `electron/erp/lanServer.cjs`
- `electron/erp/ipc.cjs`
- `electron/preload.cjs`
- `scripts/sync-temu-settlement-income.cjs`
- `scripts/erp-server.cjs`
- `scripts/test-erp-settlement-income.cjs`
- `scripts/ensure-electron-runtime.cjs`
- `extension/web/background/hook-config.js`
- `extension/web/content/_config.generated.js`
- `src/pages/MultiStoreReport.tsx`
- `src/types/electron.d.ts`
- `package.json`

## 同步方式

### 自动同步

`scripts/erp-server.cjs` 启动 ERP 服务后会自动启动结算收入同步调度：

- 默认开启：`ERP_SETTLEMENT_INCOME_AUTO_SYNC=1`
- 默认间隔：`ERP_SETTLEMENT_INCOME_SYNC_INTERVAL_MIN=15`
- 默认 ERP 库：`/opt/temu-erp-data/erp.sqlite`
- 默认云端库：`/opt/temu-cloud/data/temu-cloud.sqlite`

如需关闭：

```bash
ERP_SETTLEMENT_INCOME_AUTO_SYNC=0
```

### 手动回填

服务器上可手动跑一次：

```bash
ERP_DB=/opt/temu-erp-data/erp.sqlite \
TEMU_CLOUD_DB_PATH=/opt/temu-cloud/data/temu-cloud.sqlite \
node scripts/sync-temu-settlement-income.cjs
```

所有同步入口都会先确保 `erp_temu_settlement_income` / `erp_temu_settlement_detail` 表存在，再从 `cloud.capture_events` 读取抓包数据。

### 前端手动同步

进入「多店报表」页面，点击「同步结算数据」。同步成功后页面会刷新报表缓存。

## 排查 SQL

## 上线前预检

上线或回填前先跑只读预检，不会写 ERP 库或 cloud 库：

```bash
npm run check:erp:settlement
```

上线验收时建议加 `--deep` 做只读深度预演，脚本会扫描结算接口抓包并汇总“如果现在同步，会覆盖多少店、多少日期行”：

```bash
npm run check:erp:settlement -- --deep
```

服务器上指定路径：

```bash
ERP_DB=/opt/temu-erp-data/erp.sqlite \
TEMU_CLOUD_DB_PATH=/opt/temu-cloud/data/temu-cloud.sqlite \
npm run check:erp:settlement -- --deep
```

预检会检查：

- `cloud.capture_events` 是否存在且包含 `url_path`、`mall_id`、`body_json`、`received_at`
- 是否已经抓到 `/api/merchant/front/finance/income-summary`
- 是否已经抓到三类结算明细接口：`wait-settlement`、`in-settlement`、`settled`
- 最新抓包 body 是否能解析出每日结算收入
- `--deep` 下会统计候选入库店铺数、日期行数、最早/最新日期和金额范围
- 抓包查询是否可能全表扫描
- ERP 结算汇总表/结算明细表是否存在、是否已有数据、`mall_id` 是否能对上店铺字典

如果看到 `finance_captures_missing`，表示云端既没有采到 `income-summary`，也没有采到三类结算明细接口，优先检查 worker/扩展是否访问并上报了 Temu 商家后台结算页。
如果只看到 `income_summary_missing` 但有 `settlement_detail_present`，三态结算明细仍可同步，收入汇总维度稍后补采即可。
如果看到 `settlement_detail_missing`，表示云端还没有采到三类结算明细接口，优先确认扩展已更新并访问了 Temu「账户资金→结算数据」页。

本机当前样例库预检结果就是 `finance_captures_missing` + `settlement_detail_missing`，因为 `cloud/data/temu-cloud.sqlite` 里没有真实财务抓包；这不代表代码链路失败。上线验收要以服务器真实 cloud 库为准。

确认云端是否有抓包事件：

```sql
ATTACH DATABASE '/opt/temu-cloud/data/temu-cloud.sqlite' AS cloud;

SELECT url_path, COUNT(*) AS capture_count
FROM cloud.capture_events
WHERE url_path IN (
  '/api/merchant/front/finance/income-summary',
  '/api/merchant/settle/detail/full/wait-settlement',
  '/api/merchant/settle/detail/full/in-settlement',
  '/api/merchant/settle/detail/full/settled'
)
GROUP BY url_path;
```

确认 ERP 是否已入库：

```sql
SELECT mall_id, MAX(stat_date) AS latest_date, COUNT(*) AS rows
FROM erp_temu_settlement_income
GROUP BY mall_id
ORDER BY latest_date DESC;
```

查看单店最近结算：

```sql
SELECT mall_id, stat_date, currency, income_amount, synced_at
FROM erp_temu_settlement_income
WHERE mall_id = '<店铺 mall_id>'
ORDER BY stat_date DESC
LIMIT 30;
```

查看三类结算明细：

```sql
SELECT mall_id, site, settlement_status, stat_date,
       sales_receipt_amount, chargeback_amount, subsidy_amount, total_amount,
       source_received_at, synced_at
FROM erp_temu_settlement_detail
WHERE mall_id = '<店铺 mall_id>'
ORDER BY source_received_at DESC
LIMIT 50;
```

## 本地验证

已通过专项测试：

```bash
npm run test:erp:settlement
```

当前结果：`45 通过 / 0 失败`。

覆盖内容：

- `incomeAmount.amount` 分转元解析
- `digitalText/fullText` 兜底解析
- `statDate/dateStr` 日期字段兜底解析
- `result.rows`、`data.result` 等不同响应结构解析
- `wait-settlement / in-settlement / settled` 三类结算明细抓包物化
- 只有三态结算明细、没有 `income-summary` 时，预检不会按失败处理
- 同店同日 UPSERT 覆盖
- 按店聚合今日、近 7 天、近 30 天和趋势
- 从 `cloud.capture_events` 读取并物化
- 首次同步时自动创建结算收入表
- `--deep` 只读预检能识别候选同步行且不写 ERP 表
- 云端库无法挂载时返回跳过状态

也已通过语法检查：

```bash
node --check electron/erp/services/multiStoreReport.cjs
node --check scripts/check-temu-settlement-income.cjs
node --check scripts/test-erp-settlement-income.cjs
node --check scripts/sync-temu-settlement-income.cjs
node --check scripts/erp-server.cjs
node --check scripts/ensure-electron-runtime.cjs
node --check extension/web/background/hook-config.js
node --check extension/web/background/sw.js
```

整体构建也已通过：

```bash
npm run build
```

## 上线注意事项

1. 需要确认服务器存在 `TEMU_CLOUD_DB_PATH` 指向的云端 SQLite 文件。
2. 需要确认云端抓包服务确实采到了 `income-summary` 接口。
3. 发布后先手动跑一次 `scripts/sync-temu-settlement-income.cjs` 做回填。
4. 打开「多店报表」确认结算维度出现；如果页面提示结算维度不可用，优先检查云端库挂载路径和 `capture_events` 表。
5. 如线上只有客户端访问 ERP 服务，客户端点击「同步结算数据」会走 LAN Server 的 `/api/temu/settlement-income-sync`。
