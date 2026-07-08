-- 审批留痕：记录审批决策者
-- @idempotent
ALTER TABLE erp_agent_approvals ADD COLUMN resolved_by TEXT;
