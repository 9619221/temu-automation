#!/bin/bash
# 一次性清理：清空 capture_events 里 perf/perf-discovery 事件的 body_json。
# 背景：这两类是浏览器性能监控事件，无任何 parser 消费（cloud/parsers.js 的 PARSERS 全按业务
#       url_path 匹配），仅「接口发现」面板用其元数据、不读 body_json。它们的 body_json 约占
#       capture_events 体积的 40%（纯死数据）。配合 ingest.js 已不再为新 perf 事件落 body_json，
#       此脚本把历史 perf 行的 body_json 一次性清空，再 VACUUM 收缩。
#
# 预期：capture_events ~7.45G → ~4.5-5G，整库 ~12.7G → ~9-10G（VACUUM 后）。
#
# 用法：
#   bash purge-perf-body-json.sh            # 仅分批清空 body_json（在线安全，对采集影响小）
#   VACUUM=1 bash purge-perf-body-json.sh   # 清空后再 VACUUM 收缩（会独占锁库数分钟，建议低峰/停采集时跑）
#
# 安全说明：
#   - 分批 UPDATE + 每批 wal_checkpoint(TRUNCATE)，不产生巨型事务/WAL，崩了 sqlite 事务自动回滚。
#   - VACUUM 是原子操作，崩了不动原库；但会独占写锁、需约 1 倍库大小的临时空间。
#   - 不在脚本里 cp/backup 12G 大库（在线全库 cp 是死规则禁止项）。要快照请先停 temu-cloud.service 再离线 cp。
set -euo pipefail

DB=/opt/temu-cloud/data/temu-cloud.sqlite
BATCH=20000
SQLITE=(sqlite3 -cmd ".timeout 30000")

echo "[$(date '+%F %T')] 清理前状态："
"${SQLITE[@]}" "$DB" "SELECT 'perf 待清行数 = ' || COUNT(*) FROM capture_events WHERE kind LIKE 'perf%' AND body_json IS NOT NULL;"
ls -lh "$DB"

# 分批把 perf 历史行的 body_json 置空，每批后 checkpoint 回收 WAL
total=0
while :; do
  n=$("${SQLITE[@]}" "$DB" "UPDATE capture_events SET body_json = NULL WHERE rowid IN (SELECT rowid FROM capture_events WHERE kind LIKE 'perf%' AND body_json IS NOT NULL LIMIT $BATCH); SELECT changes();")
  "${SQLITE[@]}" "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
  total=$((total + n))
  echo "  已清空 $total 行..."
  [ "$n" -eq 0 ] && break
done
echo "[$(date '+%F %T')] body_json 清空完成，共处理 $total 行。"

if [ "${VACUUM:-0}" = "1" ]; then
  dir=$(dirname "$DB")
  avail=$(df -P -B1 "$dir" | awk 'NR==2{print $4}')
  dbsize=$(stat -c%s "$DB")
  if [ "$avail" -lt "$dbsize" ]; then
    echo "[VACUUM 跳过] 磁盘可用 $avail < 库大小 $dbsize，空间不足，先释放空间再单独 VACUUM。"
    exit 1
  fi
  echo "[$(date '+%F %T')] VACUUM 收缩中（独占锁库，耗时数分钟）..."
  "${SQLITE[@]}" "$DB" "VACUUM;"
  echo "[$(date '+%F %T')] VACUUM 完成。"
else
  echo "提示：本次未 VACUUM（库物理大小暂不缩小，空间会被后续数据复用）。需立即收缩请加 VACUUM=1 重跑。"
fi

echo "[$(date '+%F %T')] 清理后状态："
ls -lh "$DB"
