# Worker 剥离迁移方案

> 目标：把 `automation/worker.mjs`（Playwright 浏览器自动化引擎）承担的功能，按「官方开放平台 API + 浏览器扩展」两条路逐步迁出，最终把 worker 缩到最小。
> 现状：worker 处理 **80+ 个 action**，前端 **72 处 `sendCmd` 依赖**，本质是「后台开浏览器、靠登录态去 Temu/1688 后台抓数据和做操作」（抓包路线）。痛点：掉登录、对付 anti-content 反爬、稳定性差。

## 一、核心结论（先看这个）

1. **worker 删不掉，但能瘦身一大半。** 1688（阿里系，无公开 API）、云栖（第三方竞品数据平台）这些**非 Temu**的活，官方 API 和扩展都替代不了，worker 必须留着扛。
2. **Temu 的活基本都能拆走**：官方有权限的搬官方 API，要登录态操作的搬浏览器扩展。
3. **死代码占比很高**：约 20+ 个 action 前端根本没调用（广告采集 6 个、调试/探测 10+ 个、yundu 开发工具 5+ 个）。第一步直接砍，零风险、立竿见影。
4. **终态**：worker 从「什么都干的大脑」缩成「1688 + 云栖 + 少量本地逻辑」的小执行器；Temu 相关全部由 官方 API + 扩展承接。

## 二、判断依据（硬事实）

- **官方 scope（063 店 136 个权限实测）**：有 `goods.list/update`、`goods.edit.task.apply`、`goods.image.upload.global`、`modelinfo.*`、`searchrec.ad.*`、`shiporder.send`、`salesv2`、库存等；**没有** `marketing.activity.*`（活动报名）、`price.*`（调价/核价）。
- **扩展能力（已验证）**：扩展跑在用户真实浏览器、天然登录态，能直接调 Temu 内部接口且**不需 anti-content**（换图四接口实测通过）；`competitor_ext_*` 已经走扩展被动拦截（`extension/web/` 下 sw.js + bridge.js + hook.js）。
- **官方采集已落地**：商品主数据、采购/发货/销售/售后/库存、广告流量报表/生命周期/爆款邀约，均已有官方采集器（`electron/erp/services/temuOpenApiCollectors.cjs` 等），worker 抓包版可逐步下线。

## 三、全功能盘点（按迁移去向四分类）

### A. 迁官方 API（scope 已有权限）

| 功能块 | 涉及 action | 现状 | 去向理由 |
|---|---|---|---|
| 商品/采购/发货/销售/售后/库存采集 | scrape_products / scrape_orders / scrape_sales / scrape_lifecycle / yundu_list_overall | 抓包 | 官方已有对应采集器，**大部分已迁**，worker 版可下线 |
| 广告流量/生命周期/爆款采集 | （已在官方采集器） | — | 已落地官方 |
| 商品创建/编辑/上架 | create_product_api / batch_create_api / workflow_pack_images（+ remove_prop/retry_*/fix_* 子步骤） | 抓包调 `/visage-agent-seller/product/draft/add` | scope 有 `goods.update`/`goods.edit.task.apply`/`image.upload`，可迁官方写接口 |
| 自动核价上品（提交部分） | auto_pricing | 抓包（内部调 create_product_api） | 跟随商品创建迁官方 |
| 换图 | auto_image_swap → **auto_image_swap_openapi**（已就绪）/ openapi_call | 官方版已写好 | **已有官方实现**，直接切换即可 |

### B. 走浏览器扩展（官方无权限/无接口，但需登录态）

| 功能块 | 涉及 action | 现状 | 去向理由 |
|---|---|---|---|
| 活动报名 | yundu_enroll_priced / yundu_activity_match / yundu_activity_list / yundu_activity_submit | 抓包（agentseller `/api/kiana/.../enroll/*`） | 官方 `marketing.activity.*` **无权限**；扩展有登录态可直接调 |
| 流量分析 | scrape_flux_product_detail / scrape_skc_region_detail / scrape_global_performance（流量部分） | 抓包 | 官方**无流量分析 API**；扩展可抓 |
| 质量分/高价限流 | yundu_quality_metrics / yundu_high_price_limit | 抓包 | 官方无对应；扩展可抓 |
| 核价扫描（Temu 侧） | price_review_scan（Temu 价格管理页部分） | 抓包 | 官方 `price.*` **无权限**；扩展可抓申报价 |
| 竞品评论 | competitor_scrape_reviews | 抓包 | 已有 `competitor_ext_*` 扩展路，统一走扩展 |

### C. 必须保留（非 Temu 或无替代）

| 功能块 | 涉及 action | 理由 |
|---|---|---|
| 1688 采购/询盘/图搜/SKU 提取 | local_1688_inquiry / open_1688_detail / search_1688_image / extract_1688_skus | 阿里系，**无公开 API**；只能 Playwright 或 1688 专用扩展 |
| 云栖第三方数据 | set/get/fetch_yunqi_token / yunqi_*_credentials / yunqi_auto_login / yunqi_db_* | 非 Temu，第三方竞品平台，独立体系 |
| 竞品数据（云栖 API） | competitor_search / competitor_track / competitor_batch_track | 走云栖 API，与 Temo 无关 |
| 纯本地逻辑 | price_review_list/set/clear_manual_cost、pause/resume_pricing、read_scrape_data、scrape_progress、optimize_title | 本地 SQLite/状态/AI，无远程依赖 |
| 1688 登录会话 | price_review_open_1688_login | 1688 登录态管理 |

### D. 可砍（疑似死代码 / 纯调试，前端无调用）

> 下线前再全局 grep 确认无内部/扩展引用。

| 类别 | 涉及 action |
|---|---|
| 广告采集（未激活） | scrape_ads_home / product / report / finance / help / notification（6 个） |
| 调试/探测工具 | probe_page / probe_batch / debug_page / scan_menu / explore_page / capture_api / discover_pages / deep_probe / scrape_one |
| yundu 开发工具 | yundu_sniff_discover / yundu_raw / sidebar_nav / yundu_site_count / yundu_activity_enrolled / yundu_auto_enroll / yundu_capture_enroll_submit / capture_image_edit_payload |
| 其他低频/打开页 | open_temu_login / open_temu_search / competitor_auto_register（自动注册 Temu 账号，低频可选） |

## 四、分阶段路线建议

- **阶段 0｜砍死代码**（零风险，立竿见影）：清理 D 类约 20+ 个 action 及其函数，先把 worker 体积和维护面降下来。
- **阶段 1｜活动报名走扩展**（已在推进）：把 `yundu_enroll_priced` 那套搬到扩展（扩展有登录态，解决刚才 dryRun 撞到的「掉登录 40001」根因）。
- **阶段 2｜流量/质量分/核价扫描走扩展**：B 类剩余项，复用扩展被动拦截框架。
- **阶段 3｜商品创建/编辑/换图迁官方**：换图已有 openapi 版直接切；商品创建/编辑接官方 `goods.edit` 系列（工作量较大，单独排期）。
- **阶段 4｜采集类 worker 版下线**：官方采集器已覆盖的，逐个停用 worker 抓包版，前端 IPC 改指向官方。
- **终态**：worker 仅剩 C 类（1688 + 云栖 + 本地逻辑）。

## 五、风险与注意

- **官方 scope 限制**：活动报名、价格类官方无权限，要么走扩展（推荐），要么向 Temu 招商为「云舵AI」应用申请接口权限（外部商务流程，周期不定）。
- **前端 72 处依赖**：每迁一个功能，对应的 `electron/main.cjs` IPC handler 和前端调用要同步改，需逐个排查、回归。
- **扩展能力边界**：扩展跑在浏览器页面环境，复杂写操作（如整套商品创建）未必都适合，需逐个验证。
- **渐进迁移**：worker 全程留着兜底，每块迁完验证通过再下线对应抓包版，避免功能真空。
