#!/bin/bash
# 清理 migrate.cjs 自动备份：只保留最近 N 个，删除更旧的及其 wal/shm 残留。
# 由 cron 每日调用，防止 /opt/temu-erp-data/backups 无限堆积撑爆数据盘。
# 背景：migrate 每次服务启动 backup 一个 ~4G 的 erp-<ts>.sqlite，无 retention。

set -euo pipefail

DIR=/opt/temu-erp-data/backups
KEEP=${KEEP:-3}   # 保留最近几个

[ -d "$DIR" ] || { echo "[cleanup] dir not found: $DIR"; exit 0; }

# 1) 删除超出保留数的旧主备份及其 wal/shm
mapfile -t old < <(ls -1t "$DIR"/erp-*.sqlite 2>/dev/null | tail -n +$((KEEP + 1)))
for f in "${old[@]:-}"; do
  [ -n "$f" ] || continue
  echo "[cleanup] remove old backup: $f"
  rm -f -- "$f" "$f-wal" "$f-shm"
done

# 2) 清理孤儿 wal/shm（主文件已不在）
shopt -s nullglob
for r in "$DIR"/erp-*.sqlite-wal "$DIR"/erp-*.sqlite-shm; do
  main="${r%-wal}"; main="${main%-shm}"
  [ -e "$main" ] || { echo "[cleanup] remove orphan: $r"; rm -f -- "$r"; }
done

echo "[cleanup] done. kept最近 $KEEP 个，当前占用："
du -sh "$DIR"
