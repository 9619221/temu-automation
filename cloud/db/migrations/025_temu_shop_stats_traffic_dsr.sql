-- 扩展店铺统计表：活动总览、流量漏斗、DSR评分、优惠券
ALTER TABLE temu_shop_stats ADD COLUMN enrollable_activity_count INTEGER;
ALTER TABLE temu_shop_stats ADD COLUMN enrolled_activity_count INTEGER;
ALTER TABLE temu_shop_stats ADD COLUMN ongoing_activity_count INTEGER;
ALTER TABLE temu_shop_stats ADD COLUMN total_activity_count INTEGER;
ALTER TABLE temu_shop_stats ADD COLUMN visit_count INTEGER;
ALTER TABLE temu_shop_stats ADD COLUMN pay_buyer_count INTEGER;
ALTER TABLE temu_shop_stats ADD COLUMN visit_pay_rate REAL;
ALTER TABLE temu_shop_stats ADD COLUMN attention_count INTEGER;
ALTER TABLE temu_shop_stats ADD COLUMN attention_rate REAL;
ALTER TABLE temu_shop_stats ADD COLUMN trade_amount_cents INTEGER;
ALTER TABLE temu_shop_stats ADD COLUMN trade_order_count INTEGER;
ALTER TABLE temu_shop_stats ADD COLUMN dsr_score REAL;
ALTER TABLE temu_shop_stats ADD COLUMN dsr_logistics_score REAL;
ALTER TABLE temu_shop_stats ADD COLUMN dsr_service_score REAL;
ALTER TABLE temu_shop_stats ADD COLUMN dsr_description_score REAL;
ALTER TABLE temu_shop_stats ADD COLUMN coupon_active_count INTEGER;
ALTER TABLE temu_shop_stats ADD COLUMN daily_consult_visit_count INTEGER;
