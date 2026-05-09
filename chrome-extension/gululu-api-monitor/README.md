# 咕噜噜接口监听器

这个扩展只做一件事：监听咕噜噜运行时实际请求了哪些接口。

它不会注入 Temu 页面，不会上传 ERP，不会重放请求，也不会读取响应体。它只记录：

- URL
- Method
- 状态码
- 请求类型
- 发起来源 `initiator` / `documentUrl`
- 脱敏后的请求头
- 请求体摘要和 hash
- 首次/最后出现时间
- 出现次数

## 使用

1. Chrome 打开 `chrome://extensions`
2. 开启开发者模式
3. 加载已解压扩展，选择本目录：`chrome-extension/gululu-api-monitor`
4. 保持咕噜噜扩展开启
5. 打开咕噜噜挂机页或 Temu 后台，让它正常采集
6. 点击“咕噜噜接口监听器”图标，查看或导出 JSON

监听域名：

- `agentseller.temu.com`
- `agentseller-us.temu.com`
- `agentseller-eu.temu.com`
- `seller.kuajingmaihuo.com`
- `ads.temu.com`
- `lingge.gululu.store`

