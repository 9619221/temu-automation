#!/bin/bash
# 部署位置: /opt/temu-cloud/scripts/erp-retention.sh
# cron: /etc/cron.d/erp-retention  ->  45 3 * * * ubuntu bash /opt/temu-cloud/scripts/erp-retention.sh
# 作用: 仅清理纯技术日志 erp_1688_api_call_log（无业务/合规价值），保留 30 天。
#       审计/业务事件表（erp_audit_logs / erp_jst_raw_records / erp_purchase_request_events）
#       涉及合规与业务回溯，保留期需业务确认后再加，此脚本不动它们。
DB=/opt/temu-erp-data/erp.sqlite
LOG=/opt/temu-cloud/logs/erp-retention.log
n=$(sqlite3 -cmd ".timeout 15000" "$DB" "DELETE FROM erp_1688_api_call_log WHERE substr(created_at,1,10) < date('now','-30 days'); SELECT changes();" 2>>"$LOG")
sqlite3 -cmd ".timeout 15000" "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1
echo "$(date '+%F %T') erp-retention 1688_api_call_log deleted=${n:-ERR} (keep 30d)" >> "$LOG"
