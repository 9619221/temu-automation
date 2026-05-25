# Cloud Server 部署到你自己服务器

适用：Ubuntu / Debian / CentOS / RHEL，普通公网 VPS（如腾讯云轻量、阿里云、AWS Lightsail）。

## 一句话部署

在**你本机**（worktree 根目录）执行：

```bash
# 1. 把 cloud 目录整体上传到服务器（路径 ~/cloud）
scp -r cloud ubuntu@erp.temu.chat:~/

# 2. ssh 上去
ssh ubuntu@erp.temu.chat

# 3. 在服务器上跑安装脚本
cd ~/cloud
sudo bash deploy/install.sh
```

脚本最后会输出公网访问地址 + admin 密码 + 日志命令。

## 自定义参数（可选）

```bash
# 指定端口
sudo PORT=9000 bash deploy/install.sh

# 指定 admin 密码
sudo ADMIN_PASSWORD='YourStrongPass123' bash deploy/install.sh
```

## 防火墙

腾讯云轻量 / 阿里云轻量服务器默认拦外网入站，需要在控制台「防火墙」放行：

| 协议 | 端口 | 用途 |
|---|---|---|
| TCP | 22 | ssh（一般默认开） |
| TCP | 8788 | cloud server |

## 检查 / 排错

```bash
# 看服务状态
sudo systemctl status temu-cloud

# 看日志
sudo journalctl -u temu-cloud -f
sudo tail -f /var/log/temu-cloud.log

# 重启
sudo systemctl restart temu-cloud

# 升级（重新上传 cloud 目录后）
cd ~/cloud
sudo bash deploy/install.sh   # 脚本会 rsync 覆盖 + restart 服务
```

## 部署后让扩展用上

部署完后告诉 Claude **公网访问地址**（脚本最后那行 `http://x.x.x.x:8788`），他会：

1. curl `_admin/trigger-reload` 让所有装扩展的浏览器自重启
2. 引导你在扩展 options 页把 URL 改成新地址
3. 重新登录拿 JWT，扩展开始向你服务器上报

## 后续加 https（可选，生产强烈建议）

如果要给运营装扩展（chrome web store 要求 https）：

1. 把域名 DNS 指到这台服务器 IP
2. 装 Caddy：
   ```bash
   sudo apt install -y caddy
   ```
3. 写 `/etc/caddy/Caddyfile`：
   ```
   cloud.your-domain.com {
     reverse_proxy localhost:8788
   }
   ```
4. `sudo systemctl restart caddy` —— 自动从 Let's Encrypt 申请证书

之后扩展 URL 改成 `https://cloud.your-domain.com`，正式上线。

## 数据备份

数据全在 `${INSTALL_DIR}/data/temu-cloud.sqlite`（默认 `/opt/temu-cloud/data/`）。

```bash
# 备份
sudo cp -a /opt/temu-cloud/data /opt/temu-cloud/data.bak.$(date +%Y%m%d)

# 恢复
sudo systemctl stop temu-cloud
sudo cp /opt/temu-cloud/data.bak.20260509/temu-cloud.sqlite /opt/temu-cloud/data/
sudo systemctl start temu-cloud
```

## 卸载

```bash
sudo systemctl disable --now temu-cloud
sudo rm /etc/systemd/system/temu-cloud.service
sudo systemctl daemon-reload
sudo rm -rf /opt/temu-cloud /var/log/temu-cloud.log
```
