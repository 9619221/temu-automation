-- 用户级权限覆盖：在角色权限（erp_role_permissions）基础上，对单个用户单独 allow / deny
-- 某个菜单或操作。优先级高于角色默认，用于「同角色但个别人需要多/少几个权限」的场景。
-- resource_type：menu（菜单/页面，key=路由路径如 /purchase-center） | action（操作，key 如 purchase:delete）
-- access_level：allow | deny
-- @idempotent
CREATE TABLE IF NOT EXISTS erp_user_permission_overrides (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'allow',
  conditions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, user_id, resource_type, resource_key),
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  FOREIGN KEY(user_id) REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS idx_erp_user_perm_overrides_user
  ON erp_user_permission_overrides(company_id, user_id, resource_type);
