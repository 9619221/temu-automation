# Temu 巡店采集助手

这是 Chrome 扩展采集端，用来实现“像咕噜噜一样挂浏览器窗口采集”的链路。

它不调用项目里的 Playwright 原采集任务。采集由 Chrome 扩展自己完成：

1. 在已登录的 Temu 卖家后台页面注入接口监听脚本。
2. 扩展后台每天 09:00 打开/复用一个非激活 Temu 后台标签页。
3. 自动巡航商品、库存、销量、活动、退货、违规等页面。
4. 页面自己触发接口后，扩展截获响应并上传 ERP。
5. 如果已经学习到接口模板，扩展也会尝试后台补采一次。

## 能力

- 在 Temu 卖家后台页面注入 `page-hook.js`
- Hook 页面里的 `fetch` 和 `XMLHttpRequest`
- 从页面、URL、localStorage/sessionStorage、API 响应里识别当前店铺
- 将采集到的接口响应按店铺打包
- 上传到本机 ERP 桥接服务：`http://127.0.0.1:18731/api/temu-extension/store-collection/snapshot`
- 每天 09:00 自动巡店采集
- 支持点击扩展图标后手动“立即采集”
- 支持打开扩展挂机页，保持 Chrome 扩展后台活跃

## 安装

1. 启动桌面端 ERP，确保本机桥接服务已启动
2. 打开 Chrome：`chrome://extensions`
3. 开启“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择本目录：`chrome-extension/temu-patrol`
6. 打开已登录的 Temu 卖家后台页面，让扩展识别当前店铺
7. 点击扩展图标，点“打开挂机页”
8. 需要马上测试时，点“立即采集”

## 采集方式

扩展会自动访问这些 Temu 后台页面并等待接口响应：

- 首页概览
- 商品列表
- 商品数据
- 销量/履约
- 售罄/补货
- 紧急备货
- 退货/售后
- 活动数据
- 营销活动
- 流量分析
- 体检中心
- 质量看板

如果某个页面地址在 Temu 后台发生变化，对应页面可能采不到数据；这种情况下需要更新 `background.js` 里的 `PATROL_PAGES`。

## 接口字典

扩展会优先用 `api-dictionary.js` 判断接口类型，再用 URL 关键词兜底分类。

目前字典里已经收录从咕噜噜本地扩展提取到的 Temu 接口线索，包括：

- 销售管理：`/mms/venom/api/supplier/sales/management/listOverall`
- SKC 销售：`/bg-brando-mms/supplier/data/center/skc/sales/data`
- 广告明细：`/api/v1/coconut/ad/ads_detail`
- 活动报名：`/api/kiana/gamblers/marketing/enroll/feedback/queryValidActivity4FeedBackOffline`
- 发货/备货单：`/bgSongbird-api/supplier/deliverGoods/platform/pageQuerySubPurchaseOrder`
- 资金明细：`/api/merchant/fund/detail/pageSearch`
- 类目和模板：`/anniston-agent-seller/category/children/list`, `/anniston-agent-seller/category/template/query`
- 商品流量：`/api/seller/full/flow/analysis/goods/list`

完整说明见 `docs/temu-api-dictionary.md`，前端/服务端可读版本见 `src/config/temuApiDictionary.ts`。

## 和原采集项目的关系

这个扩展不调用 `automation/worker.mjs`，也不调用 `scrape_all`。

原采集项目可以保留给旧数据采集页使用，但巡店控制台要走扩展上传的巡店快照。

## 本地接口

- `GET /api/temu-extension/health`
- `POST /api/temu-extension/store`
- `POST /api/temu-extension/store-collection/snapshot`

扩展请求会带：

```http
X-Temu-Extension-Bridge: temu-patrol-v1
```

ERP 会把快照保存到 `erp_store_collection_snapshots`，明细保存到 `erp_store_collection_snapshot_sources`。
