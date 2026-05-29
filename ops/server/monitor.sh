#!/bin/bash
# 部署位置: /opt/temu-cloud/scripts/monitor.sh
# cron: /etc/cron.d/temu-monitor  ->  */5 * * * * ubuntu bash /opt/temu-cloud/scripts/monitor.sh
# 作用: 每 5 分钟巡检磁盘/内存/服务/端点；异常写 monitor.log，并（若配置 FEISHU_BOT_WEBHOOK）推飞书。
LOG=/opt/temu-cloud/logs/monitor.log
ALERTS=()
USE=$(df / | awk 'NR==2{print $5}' | tr -d '%')
[ "${USE:-0}" -ge 85 ] && ALERTS+=("磁盘使用 ${USE}% (>=85%)")
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
[ "${AVAIL:-9999}" -lt 150 ] && ALERTS+=("可用内存 ${AVAIL}MB (<150)")
for svc in temu-cloud temu-erp; do
  systemctl is-active --quiet "$svc.service" || ALERTS+=("$svc 服务非 active")
done
CODE=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 12 https://erp.temu.chat/ 2>/dev/null)
[ "$CODE" != "302" ] && [ "$CODE" != "200" ] && ALERTS+=("erp.temu.chat 异常 HTTP=$CODE")
TS=$(date '+%F %T')
if [ ${#ALERTS[@]} -gt 0 ]; then
  MSG=$(printf '%s; ' "${ALERTS[@]}")
  echo "$TS ALERT: $MSG" >> "$LOG"
  WEBHOOK="${FEISHU_BOT_WEBHOOK:-}"
  [ -z "$WEBHOOK" ] && [ -f /opt/temu-cloud/.env ] && WEBHOOK=$(grep -E '^FEISHU_BOT_WEBHOOK=' /opt/temu-cloud/.env | cut -d= -f2-)
  [ -n "$WEBHOOK" ] && curl -s -m 10 -X POST "$WEBHOOK" -H 'Content-Type: application/json' \
    -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"[Temu 运维告警] $TS\n$MSG\"}}" >/dev/null 2>&1
else
  echo "$TS OK disk=${USE}% mem=${AVAIL}MB http=$CODE" >> "$LOG"
fi
tail -n 3000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
