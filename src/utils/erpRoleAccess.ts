export type ErpRole = "admin" | "manager" | "operations" | "buyer" | "finance" | "warehouse" | "viewer" | string;

export interface ErpSessionUser {
  id: string;
  name: string;
  role: ErpRole;
  status: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  manager: "负责人",
  operations: "运营",
  buyer: "采购",
  finance: "财务",
  warehouse: "仓库",
  viewer: "只读",
};

const DEFAULT_PATH_BY_ROLE: Record<string, string> = {
  admin: "/daily-command",
  manager: "/daily-command",
  operations: "/daily-command",
  buyer: "/daily-command",
  finance: "/daily-command",
  warehouse: "/daily-command",
  viewer: "/daily-command",
};

const ROUTE_ROLES: Record<string, string[]> = {
  "/daily-command": ["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"],
  "/product-master-data": ["admin", "manager", "operations", "buyer"],
  "/purchase-center": ["admin", "manager", "operations", "buyer", "finance"],
  "/warehouse-center": ["admin", "manager", "warehouse"],
  "/qc-outbound": ["admin", "manager", "operations", "warehouse"],
  "/work-items": ["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"],
  "/shop": ["admin", "manager", "operations", "viewer"],
  "/products": ["admin", "manager", "operations", "viewer"],
  "/create-product": ["admin", "manager", "operations"],
  "/image-studio": ["admin", "manager", "operations"],
  "/image-studio-gpt": ["admin", "manager", "operations"],
  "/collect": ["admin", "manager", "operations"],
  "/accounts": ["admin", "manager", "operations"],
  "/competitor": ["admin", "manager", "operations"],
  "/price-review": ["admin", "manager", "operations"],
  "/users": ["admin", "manager"],
  "/erp-debug": ["admin", "manager"],
  "/logs": ["admin", "manager", "operations"],
  "/settings": ["admin", "manager"],
};

const SCOPED_WORK_ITEM_ROLES = new Set(["operations", "buyer", "finance", "warehouse"]);

export function roleLabel(role?: string | null) {
  return ROLE_LABELS[role || ""] || role || "-";
}

export function getDefaultPathForRole(role?: string | null) {
  return DEFAULT_PATH_BY_ROLE[role || ""] || "/daily-command";
}

export function canAccessRoute(role: string | null | undefined, pathname: string) {
  if (!role) return false;
  if (role === "admin" || role === "manager") return true;
  const normalized = pathname.startsWith("/products/") ? "/products" : pathname;
  const allowed = ROUTE_ROLES[normalized];
  if (!allowed) return false;
  return allowed.includes(role);
}

export function getDefaultWorkItemOwnerRole(role?: string | null) {
  return role && SCOPED_WORK_ITEM_ROLES.has(role) ? role : "__all";
}

export function canViewAllWorkItems(role?: string | null) {
  return role === "admin" || role === "manager";
}
