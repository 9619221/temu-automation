# 2026-05-29 服务器运维改动台账

本目录归档当日在生产服务器（erp.temu.chat / 腾讯云 Ubuntu-HKuM，2 核 4G）落地的运维脚本与
系统配置。与主仓代码改动（commit `2b2105d`）配套。**所有改动当日均已在服务器生效。**

## 背景（事故根因）

`temu-cloud`(8788) 的 `temu-cloud.sqlite` 膨胀到 ~12GB，在 4G 内存机上无法进 page cache，
导致持续读盘、`iowait` 86%，把同机的 ERP 登录一起拖垮（「连接主控端超时」）。
根因：抓取把飞书多维表格（2–4MB/条）等大响应整包入库，只进不清。

救火：加 4G swap → 删飞书误抓/清 >200KB 大 body → VACUUM（13G→7.3G）→ iowait 降到个位数、登录恢复。

## 运维脚本（部署在 `/opt/temu-cloud/scripts/`）

| 脚本 | cron | 作用 |
|---|---|---|
| `temu-cloud-retention.sh` | `/etc/cron.d/temu-cloud-retention` 每日 03:30 | capture_events/heartbeats 保留 14 天 |
| `erp-retention.sh` | `/etc/cron.d/erp-retention` 每日 03:45 | erp.sqlite 的 1688 API 调试日志保留 30 天 |
| `monitor.sh` | `/etc/cron.d/temu-monitor` 每 5 分钟 | 巡检磁盘/内存/服务/端点，异常写 log + 可推飞书 |

## 系统配置改动

- `/etc/systemd/system/temu-erp.service.d/30-bind.conf` → `ERP_BIND_ADDRESS=127.0.0.1`（19380 只绑回环，公网只经 Caddy TLS）
- cloud `server.js` → 8788 绑 `127.0.0.1`（已入 git）
- `/etc/logrotate.d/temu-cloud` → temu-cloud.log 每日轮转、保留 7 天、压缩（需 `su root root`）
- swap → `/swapfile` 4G（已写 `/etc/fstab`）
- `/opt/temu-cloud/.env` → `AI_ANALYZE_KEY` / `AI_GENERATE_KEY` / `AI_DESKTOP_TOKEN`（**值不入 git**）

## 待办（需人工/业务决策）

- [ ] 飞书告警：建群机器人，把 webhook 写入 `/opt/temu-cloud/.env` 的 `FEISHU_BOT_WEBHOOK`
- [ ] erp.sqlite 其余日志表（audit_logs / jst_raw_records / purchase_request_events）保留期需业务确认
- [ ] 客户端 AI 改动发版前真机验证（生图 grsai SSE / 竞品视觉对比）
- [ ] 已泄露的 AI Key / cloud admin 密码轮换（用户暂决定不换）
- [ ] 服务器与 git 仍有历史分叉（如 ingest.js git 比服务器新），长期需系统对齐
- [ ] 权限「白名单外默认放行」→ 默认拒绝（需先加观测日志核对，避免误拒）
