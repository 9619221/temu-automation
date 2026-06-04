-- @idempotent
-- 出库中心 cloud-only 官方单「本地确认发货」状态表。
--
-- 背景：聚水潭 5/19 退场后，纯官方新单(无聚水潭 o_id)的确认发货 / 扣库存状态无处可存——
-- 官方物化表 erp_temu_openapi_consign 由 cron 整表 DELETE 重灌(temuOpenApiConsign.cjs)，
-- 绝不能把本地状态写在它上面。这张独立表按 (mall_id, so_id=WB备货单号) 承载 cloud-only 单的
-- 本地发货状态，refresh / rebuild 都不碰它。聚水潭单(both/jst)的同类状态仍存 jst_consign_deliveries，
-- 本表只管 cloud-only。
--
-- 无 company_id：cloud 单来自官方 API 按 mall_id 维度、全局唯一，本无 company 概念，
-- 与 UNIFIED_CONSIGN_CTE 的 cloud_agg / cloud_only 段不按 company 过滤一致。
--
-- 读取：lanServer.cjs UNIFIED_CONSIGN_CTE 的 cloud_only 段 LEFT JOIN 本表取 local_status_override/inventory_deducted。
-- 写入：electron/erp/services/consignDeliverShip.cjs 的 cloud 系列函数(ship/unship/setItemShipQty)。
-- PK (mall_id, so_id) 同时充当 CTE join 与按单查询的覆盖索引，无需额外索引。

CREATE TABLE IF NOT EXISTS erp_consign_local_state (
  mall_id               TEXT NOT NULL,
  so_id                 TEXT NOT NULL,      -- subPurchaseOrderSn(WB)，= erp_temu_openapi_consign.so_id
  inventory_deducted    INTEGER NOT NULL DEFAULT 0,
  local_status_override TEXT,               -- '已发货' / NULL（覆盖显示状态）
  inventory_ledger_json TEXT,               -- 扣减流水（撤销按此原样回补 / 审计）
  ship_qty_json         TEXT,               -- 逐 SKU 实发 {productSkuId: qty}（缺省 = 备货数）
  local_status_by       TEXT,
  local_status_at       TEXT,
  updated_at            TEXT NOT NULL,
  PRIMARY KEY (mall_id, so_id)
);
