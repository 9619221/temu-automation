"use strict";

// 权限引擎：Deny > Ask > Allow（照搬 Claude Code 模型）
// Deny 优先级最高，即使有更具体的 Allow 也会被拒
// Ask 强制提示，即使有 Allow
// Allow 直接通过

class PermissionEngine {
  constructor(rules = {}) {
    this._deny = (rules.deny || []).map(r => this._compile(r));
    this._ask = (rules.ask || []).map(r => this._compile(r));
    this._allow = (rules.allow || []).map(r => this._compile(r));
  }

  check(toolName, input = {}) {
    // 1. Deny 最高优先级
    if (this._matchAny(this._deny, toolName)) return "deny";
    // 2. Ask 次高
    if (this._matchAny(this._ask, toolName)) return "ask";
    // 3. Allow 最低
    if (this._matchAny(this._allow, toolName)) return "allow";
    // 4. 默认：ask（安全第一）
    return "ask";
  }

  _compile(pattern) {
    // "erp.purchase.*" → /^erp\.purchase\..*/
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp("^" + escaped + "$");
  }

  _matchAny(rules, toolName) {
    return rules.some(rx => rx.test(toolName));
  }

  addRule(level, pattern) {
    const target = level === "deny" ? this._deny : level === "ask" ? this._ask : this._allow;
    target.push(this._compile(pattern));
  }

  removeRule(level, pattern) {
    const compiled = this._compile(pattern).source;
    const target = level === "deny" ? this._deny : level === "ask" ? this._ask : this._allow;
    const idx = target.findIndex(rx => rx.source === compiled);
    if (idx >= 0) target.splice(idx, 1);
  }
}

// 默认权限规则
const DEFAULT_RULES = {
  deny: [
    "*.delete_*",
    "*.drop_*",
    "*.modify_permissions",
    "*.reset_database",
  ],

  ask: [
    "erp.purchase.create_order",
    "erp.purchase.confirm_order",
    "erp.pricing.adjust_price",
    "erp.image.publish_to_live",
    "erp.review.reply",
    "erp.supplier.change",
    "erp.outbound.cancel_shipment",
    "agent.memory.save_experience",
  ],

  allow: [
    // 所有只读查询
    "erp.db.query",
    "erp.snapshot.*",
    "erp.reports.*",
    "erp.inventory.get_*",
    "erp.inventory.list_*",
    "erp.purchase.list_*",
    "erp.purchase.get_*",
    "erp.supplier.list",
    "erp.supplier.list_*",
    "erp.supplier.get_*",
    "erp.outbound.get_*",
    "erp.review.list_*",
    "erp.review.get_*",

    // 低风险写操作
    "erp.purchase.create_draft",
    "erp.outbound.process_normal",
    "erp.inventory.create_inbound",
    "erp.image.generate_*",
    "erp.title.optimize",
    "erp.data.sync_*",

    // Agent 内部操作
    "agent.memory.recall",
    "agent.memory.save",
    "agent.schedule.followup",
    "agent.report_issue",
    "agent.delegate",
    "agent.log.*",
  ],
};

function createDefaultPermissions() {
  return new PermissionEngine(DEFAULT_RULES);
}

module.exports = { PermissionEngine, DEFAULT_RULES, createDefaultPermissions };
