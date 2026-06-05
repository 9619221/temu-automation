-- @idempotent
-- 评价评论中文翻译列：外文买家评论翻成简体中文存这列，前端「评价」Tab 只显示中文。
-- 翻译由 scripts/refresh-review-translations.cjs（cron）调 LLM 填充；中文评论原样存。
ALTER TABLE erp_temu_reviews ADD COLUMN comment_zh TEXT;
