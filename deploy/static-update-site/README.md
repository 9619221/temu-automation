# Static Update Site

这是静态更新站点模板目录。

## 当前打包版本

- 版本：`0.1.84`
- 安装包：`releases/temu-automation-setup-0.1.84.exe`

## 目录说明

- `index.html`
  用于人工访问和下载的首页
- `releases/latest.yml`
  给桌面客户端自动更新读取
- `releases/*.exe`
  Windows 安装包
- `releases/*.blockmap`
  差量更新元数据

## 客户端填写地址

不要填首页地址，客户端应填写：

```text
https://your-domain.com/releases/
```

## 部署方法

把整个 `static-update-site` 目录上传到静态站点根目录即可。
