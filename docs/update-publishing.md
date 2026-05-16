# 更新发布说明

## 目标

让已安装客户端通过 `设置 -> 应用更新` 检查并下载新版本。

当前默认更新源已经改成 GitHub Releases：

- 仓库：`9619221/temu-automation`

只有在你需要覆盖成自建更新目录时，才需要填写“自定义更新源地址”。

## 客户端依赖

默认情况下，客户端会从 GitHub Releases 读取版本信息和安装包。

如果你手动填写了自定义更新源地址，客户端才会从该地址请求：

- `latest.yml`
- `temu-automation-setup-<version>.exe`
- 对应 `.blockmap`

## 每次发布步骤

1. 更新 [package.json](C:/Users/Administrator/temu-automation/package.json) 里的 `version`
2. 执行：
   - `npm run dist:win`
   - 这一步会自动执行 `npm run normalize:update-yml`，把 `release/latest.yml` 里的安装包地址改成相对文件名，避免客户端下载大安装包时绕回 GitHub 直连。
3. 在 GitHub 仓库里创建一个新的 Release（例如 `v0.1.1`）
4. 将 [release](C:/Users/Administrator/temu-automation/release) 目录中的这些文件作为 Release assets 上传：
   - `latest.yml`
   - `temu-automation-setup-<version>.exe`
   - `temu-automation-setup-<version>.exe.blockmap`

## 示例

如果你选择使用默认的 GitHub Releases，就不需要在客户端填写任何更新地址。

如果你把文件传到自定义目录：

- `https://your-domain.com/temu-desktop/releases/`

那客户端里的 `自定义更新源地址` 才填：

- `https://your-domain.com/temu-desktop/releases/`

## 注意事项

- 更新源必须能被客户端直接访问
- 上传前确认 `latest.yml` 里的 `url` 和 `path` 是 `temu-automation-setup-<version>.exe` 这种相对文件名，不要是 `https://github.com/...exe`。否则检查更新会走镜像，但下载安装包仍会走 GitHub 直连，速度会很慢。
- 建议把旧版本安装包也保留一段时间，方便回滚
- 如果版本号没变，客户端不会把它当成新版本
- 发布后可以先在一台测试机里点一次 `检查更新` 做验证
