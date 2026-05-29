#!/bin/bash
# 部署位置: /opt/temu-cloud/scripts/retention.sh
# cron: /etc/cron.d/temu-cloud-retention  ->  30 3 * * * ubuntu bash /opt/temu-cloud/scripts/retention.sh
# 作用: temu-cloud 原始抓取事件保留 RETENTION_DAYS 天（默认 14），防 sqlite 无限膨胀。
DB=/opt/temu-cloud/data/temu-cloud.sqlite
LOG=/opt/temu-cloud/logs/retention.log
DAYS=${RETENTION_DAYS:-14}
CUT=$(( ($(date +%s) - DAYS*86400) * 1000 ))
ce=$(sqlite3 -cmd ".timeout 15000" "$DB" "DELETE FROM capture_events WHERE received_at < $CUT; SELECT changes();")
hb=$(sqlite3 -cmd ".timeout 15000" "$DB" "DELETE FROM agent_heartbeats WHERE ts < $CUT; SELECT changes();")
sqlite3 -cmd ".timeout 15000" "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
echo "$(date '+%F %T') retention keep=${DAYS}d capture_events=-${ce:-0} heartbeats=-${hb:-0}" >> "$LOG"
