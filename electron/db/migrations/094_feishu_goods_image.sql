-- @idempotent
-- 货盘货品图片：存 /uploads/ 下相对路径（由飞书附件下载转存），前端拼服务器域名展示
ALTER TABLE erp_feishu_supplier_goods ADD COLUMN image_url TEXT;
