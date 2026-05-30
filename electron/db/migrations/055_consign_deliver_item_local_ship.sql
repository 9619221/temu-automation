-- @idempotent
-- 送仓托管明细「本地实发数量」local_ship_qty。
-- 语义：默认 NULL = 用聚水潭备货数量 qty（即默认全发）；用户在出库中心展开明细逐条改小后存这里。
-- 确认发货（consign_deliver_ship）按 COALESCE(local_ship_qty, qty) 扣本地库存，发多少扣多少。
-- 该列只由桌面端/主控端本地动作写，不来自聚水潭同步，故聚水潭再同步覆盖 qty 也不影响本地实发值。
ALTER TABLE jst_consign_deliver_items ADD COLUMN local_ship_qty INTEGER;
