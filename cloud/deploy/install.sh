#!/usr/bin/env bash
# Temu 多店监控 · cloud server 一键部署
# 在 cloud/ 目录里运行：sudo bash deploy/install.sh
# 默认监听 8788。如果想换端口，在运行前 export PORT=xxxx

set -euo pipefail

PROJECT_NAME="temu-cloud"
INSTALL_DIR="/opt/${PROJECT_NAME}"
SERVICE_USER="${SUDO_USER:-${USER}}"
PORT="${PORT:-8788}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme123}"

# 校验：必须用 sudo 跑
if [ "$(id -u)" != "0" ]; then
  echo "[err] 请用 sudo 运行：sudo bash deploy/install.sh"
  exit 1
fi

# 校验：脚本必须在 cloud 目录里跑
CLOUD_SRC="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -f "${CLOUD_SRC}/server.js" ] || [ ! -f "${CLOUD_SRC}/package.json" ]; then
  echo "[err] 请确认在 cloud/ 目录运行（找不到 server.js / package.json）"
  exit 1
fi

echo "[1/6] 探测系统..."
. /etc/os-release
echo "  OS: ${PRETTY_NAME}  arch: $(uname -m)"

echo "[2/6] 安装 Node.js 20..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(parseInt(process.versions.node))')" -lt 20 ]; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs build-essential
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs gcc-c++ make
  else
    echo "[err] 不支持的 Linux 发行版，需手动装 Node 20+"
    exit 1
  fi
fi
node --version
npm --version

echo "[3/6] 拷贝代码到 ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
# 排除 node_modules、data，全量同步源码
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude 'deploy/install.sh' \
  "${CLOUD_SRC}/" "${INSTALL_DIR}/"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

echo "[4/6] 安装依赖 + 跑迁移 + 创建 admin..."
sudo -u "${SERVICE_USER}" bash -c "
  cd ${INSTALL_DIR}
  npm install --omit=dev --no-audit --no-fund 2>&1 | tail -10
  node -e \"import('./db/migrate.js').then(m=>m.migrate()).then(r=>console.log('migrated:',r))\"
  node scripts/seed.js '${ADMIN_PASSWORD}'
"

echo "[5/6] 写 systemd unit..."
JWT_SECRET="$(openssl rand -hex 32)"
cat > /etc/systemd/system/temu-cloud.service <<EOF
[Unit]
Description=Temu 多店监控 cloud server
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=PORT=${PORT}
Environment=JWT_SECRET=${JWT_SECRET}
Environment=DATA_DIR=${INSTALL_DIR}/data
ExecStart=$(command -v node) ${INSTALL_DIR}/server.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/temu-cloud.log
StandardError=append:/var/log/temu-cloud.log

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable temu-cloud
systemctl restart temu-cloud
sleep 2

echo "[6/6] 验证..."
if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null; then
  echo "  ✓ http://127.0.0.1:${PORT}/ 响应正常"
else
  echo "  ✗ 服务没起来，看日志：journalctl -u temu-cloud -n 50"
  exit 1
fi

echo ""
echo "========================================"
echo " 部署完成"
echo "========================================"
echo " 端点:   http://0.0.0.0:${PORT}/"
echo " 公网:   http://$(curl -fsS https://api.ipify.org 2>/dev/null || echo '<服务器外网IP>'):${PORT}/"
echo " 管理:   admin / ${ADMIN_PASSWORD}"
echo " 日志:   sudo journalctl -u temu-cloud -f"
echo "         sudo tail -f /var/log/temu-cloud.log"
echo " 重启:   sudo systemctl restart temu-cloud"
echo " 停止:   sudo systemctl stop temu-cloud"
echo ""
echo " 请确认服务器防火墙已放行 ${PORT}/tcp（腾讯云轻量在控制台 → 防火墙 → 添加规则）"
echo " 然后告诉 Claude 这个公网地址，他会接管扩展端切换"
echo "========================================"
