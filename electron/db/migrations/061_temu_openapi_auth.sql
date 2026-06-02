-- TEMU 官方开放平台凭证：按店铺(mall_id)维度存 app_key/app_secret/access_token + region
--
-- 背景：官方开放平台没有 OAuth 回调换 token 这一套，access_token 由卖家在卖家中心
--       「授权管理」勾接口后手动复制，店铺维度唯一（重新授权后旧 token 立即失效）。
--       故一店一行，PK = mall_id。
-- 写入：由「绑定店铺」路由（ipc.cjs bindTemuOpenApiMall / lanServer /api/temu/openapi/bind）
--       在落库前用 bg.open.accesstoken.info.get(.global) + bg.mall.info.get 实调校验，
--       mall_id 以校验返回为准（防止把 token 绑错店）。
-- 关联：mall_id 对齐 erp_temu_malls(店铺字典)；绑定新店时顺带 INSERT OR IGNORE 进字典。

CREATE TABLE IF NOT EXISTS erp_temu_openapi_auth (
  mall_id TEXT PRIMARY KEY,
  mall_name TEXT,
  region TEXT NOT NULL DEFAULT 'CN',
  app_key TEXT NOT NULL,
  app_secret TEXT NOT NULL,
  access_token TEXT NOT NULL,
  semi_managed INTEGER NOT NULL DEFAULT 0,
  api_scopes_json TEXT NOT NULL DEFAULT '[]',
  token_info_json TEXT NOT NULL DEFAULT '{}',
  access_token_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  authorized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_erp_temu_openapi_auth_status ON erp_temu_openapi_auth(status);
CREATE INDEX IF NOT EXISTS idx_erp_temu_openapi_auth_region ON erp_temu_openapi_auth(region);
