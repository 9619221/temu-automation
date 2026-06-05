-- @idempotent
-- 评价区域列：全球(agentseller) / 美区(agentseller-us) / 欧区(agentseller-eu)。
-- 来自 cloud temu_review_snapshot.site（抓包站点），由 temuCloudReviewSync 同步存入，前端「评价」Tab 按区域筛选。
ALTER TABLE erp_temu_reviews ADD COLUMN site TEXT;
