import { Tag } from "antd";

export const PR_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  submitted: "运营已提交",
  buyer_processing: "采购处理中",
  sourced: "已找货源",
  waiting_ops_confirm: "待运营确认",
  converted_to_po: "已转采购单",
  rejected: "已驳回",
  cancelled: "已取消",
};

export const PO_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pushed_pending_price: "待改价",
  pending_finance_approval: "待审批",
  approved_to_pay: "待付款",
  paid: "已付款",
  supplier_processing: "供应商备货",
  shipped: "供应商已发货",
  arrived: "货已到仓",
  inbounded: "已入库",
  closed: "已关闭",
  delayed: "已延期",
  exception: "异常",
  cancelled: "已取消",
};

// 回退按钮按"当前状态"决定语义化标签——撤销的是把单子推到当前状态那一步操作。
// key = row.status（FROM 状态），value = 该状态对应的撤销动作。
export const PO_ROLLBACK_BUTTON_LABELS: Record<string, string> = {
  pushed_pending_price: "撤销推单",
  pending_finance_approval: "取消财审",
  approved_to_pay: "撤销提交",
  paid: "撤销付款",
  supplier_processing: "撤销备货",
  shipped: "撤销发货",
  arrived: "撤销到货",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "待审批",
  approved: "已批准",
  paid: "已付款",
  rejected: "已驳回",
  unpaid: "未付款",
  deposit_paid: "已付定金",
  partial_refund: "部分退款",
  deducted: "已扣款",
};

export const INBOUND_STATUS_LABELS: Record<string, string> = {
  pending_arrival: "待到货",
  arrived: "已到仓",
  counted: "已核数",
  inbounded_pending_qc: "已入库待质检",
  quantity_mismatch: "数量异常",
  damaged: "破损异常",
  exception: "异常",
  cancelled: "已取消",
};

export const BATCH_QC_STATUS_LABELS: Record<string, string> = {
  pending: "待质检",
  passed: "质检通过",
  passed_with_observation: "观察放行",
  partial_passed: "部分通过",
  failed: "质检不通过",
  rework_required: "需返工",
};

export const QC_STATUS_LABELS: Record<string, string> = {
  pending_qc: "待抽检",
  in_progress: "抽检中",
  passed: "通过",
  passed_with_observation: "观察通过",
  partial_passed: "部分通过",
  failed: "不通过",
  rework_required: "需返工",
  exception: "异常",
};

export const OUTBOUND_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_warehouse: "待仓库处理",
  picking: "拣货中",
  packed: "已打包",
  shipped_out: "已发出",
  pending_ops_confirm: "待运营确认",
  confirmed: "已确认",
  exception: "异常",
  cancelled: "已取消",
};

export const WORK_ITEM_STATUS_LABELS: Record<string, string> = {
  new: "新事项",
  in_progress: "处理中",
  waiting_operations: "等待运营",
  waiting_buyer: "等待采购",
  waiting_finance: "等待财务",
  waiting_warehouse: "等待仓库",
  waiting_supplier: "等待供应商",
  done: "已完成",
  dismissed: "已关闭",
};

export const WORK_ITEM_OWNER_LABELS: Record<string, string> = {
  admin: "管理员",
  manager: "负责人",
  operations: "运营",
  buyer: "采购",
  finance: "财务",
  warehouse: "仓库",
};

// 状态色谱（参考聚水潭语义）：
//   橙/金 (gold/orange) = 待办，需要人盯
//   蓝/青 (blue/cyan/processing) = 进行中
//   绿 (success/green) = 已完成、已通过
//   红 (error/red) = 异常、失败、退款类
//   灰 (default) = 草稿、已取消、已关闭、已归档
const STATUS_COLOR: Record<string, string> = {
  // 通用 / 草稿
  draft: "default",
  closed: "default",
  cancelled: "default",
  unpaid: "default",
  dismissed: "default",
  unset: "default",
  none: "default",

  // PR 状态
  submitted: "gold",            // 运营已提交（待采购接）
  buyer_processing: "processing",
  sourced: "cyan",
  waiting_ops_confirm: "gold",
  converted_to_po: "success",
  rejected: "error",

  // PO 状态
  pushed_pending_price: "orange",  // 已推单待改价（醒目）
  pending_finance_approval: "gold",
  approved_to_pay: "orange",       // 待付款，钱要出去了
  paid: "blue",                    // 已付款（处理中）
  supplier_processing: "processing",
  shipped: "blue",
  arrived: "cyan",
  inbounded: "success",
  delayed: "warning",
  exception: "error",
  orphan_cleared: "default",       // 死单清理后
  bound: "blue",
  created: "blue",
  previewed: "cyan",
  price_change_requested: "gold",
  price_synced: "cyan",
  refund_requested: "error",
  partial_shipped: "processing",
  received_goods: "success",
  success: "success",
  logistics_updated: "cyan",
  memo_modified: "default",
  imported: "default",

  // 1688 真实状态字符串
  waitbuyerpay: "orange",
  waitsellersend: "blue",
  cancel: "default",
  signsuccess: "success",

  // 付款审批
  pending: "gold",
  approved: "blue",
  deposit_paid: "cyan",
  partial_refund: "error",
  deducted: "success",

  // 入库
  pending_arrival: "gold",
  counted: "cyan",
  inbounded_pending_qc: "blue",
  quantity_mismatch: "error",
  damaged: "error",

  // 质检
  passed: "success",
  passed_with_observation: "cyan",
  partial_passed: "warning",
  failed: "error",
  rework_required: "error",
  pending_qc: "gold",
  in_progress: "processing",

  // 出库
  pending_warehouse: "gold",
  picking: "processing",
  packed: "cyan",
  shipped_out: "blue",
  pending_ops_confirm: "gold",
  confirmed: "success",

  // 工单
  new: "gold",
  done: "success",
  waiting_operations: "gold",
  waiting_buyer: "gold",
  waiting_finance: "gold",
  waiting_warehouse: "gold",
  waiting_supplier: "gold",
};

export function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

export function formatDate(value?: string | null) {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleDateString("zh-CN");
}

export function formatMoney(value?: number | string | null) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return `¥${number.toFixed(2)}`;
}

export function formatQty(value?: number | string | null) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return `${number}`;
}

export function formatPercent(value?: number | string | null) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return `${(number * 100).toFixed(1)}%`;
}

export function statusLabel(value?: string | null, labels?: Record<string, string>) {
  if (!value) return "-";
  return labels?.[value] || "未知状态";
}

export function statusTag(value?: string | null, labels?: Record<string, string>) {
  const key = value || "";
  return <Tag color={STATUS_COLOR[key] || "default"}>{statusLabel(value, labels)}</Tag>;
}

export function priorityTag(value?: string | null) {
  const priority = value || "-";
  const color = priority === "P0" ? "red" : priority === "P1" ? "orange" : priority === "P2" ? "blue" : "default";
  const label: Record<string, string> = {
    P0: "紧急",
    P1: "高",
    P2: "中",
    P3: "低",
  };
  return <Tag color={color}>{label[priority] || "未定"}</Tag>;
}

export function canRole(role: string | undefined | null, allowed: string[]) {
  return !!role && allowed.includes(role);
}
