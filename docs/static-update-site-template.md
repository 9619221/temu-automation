# 静态站点更新源模板

项目里已经带了一套现成模板，不需要你自己手工拼目录。

## 模板位置

- 模板输出目录：
  [deploy/static-update-site](C:/Users/Administrator/temu-automation/deploy/static-update-site)

## 一键生成模板

先确保已经打过安装包：

```bash
npm run dist:win
```

然后执行：

```bash
npm run prepare:update-site
```

执行后会自动把最新发布文件整理到：

- `deploy/static-update-site/index.html`
- `deploy/static-update-site/releases/latest.yml`
- `deploy/static-update-site/releases/*.exe`
- `deploy/static-update-site/releases/*.blockmap`

## 模板内容

这套模板会生成：

1. 一个首页 `index.html`
   用于人工访问、下载最新安装包、确认当前版本
2. 一个 `releases/` 目录
   这是桌面客户端真正使用的自动更新目录
3. 一个模板目录说明 `README.md`

## 客户端怎么填

客户端里的更新源地址不要填首页。

应该填：

```text
https://your-domain.com/releases/
```

如果你把整个 `deploy/static-update-site` 上传到了：

```text
https://download.example.com/temu-desktop/
```

那客户端设置中填写的地址就是：

```text
https://download.example.com/temu-desktop/releases/
```

## 适合部署到哪里

这套模板适合直接上传到：

- Nginx 静态目录
- OSS / COS / S3 / R2 桶静态目录
- Cloudflare Pages 静态目录
- 任意支持纯静态文件托管的空间

## 最推荐的发布动作

每次发版按这个顺序：

1. 改版本号
2. `npm run dist:win`
3. `npm run prepare:update-site`
4. 上传 `deploy/static-update-site` 整个目录
5. 用测试机点一次 `检查更新`

`prepare:update-site` 会先归一化 `release/latest.yml`，确保安装包地址使用相对文件名。这样客户端填写 `/releases/` 目录后，`latest.yml`、安装包和 `.blockmap` 都会从同一个更新源下载。

## 说明

这套模板的目标不是做官网，而是给桌面客户端提供一个稳定、清楚、低维护的静态更新源。
