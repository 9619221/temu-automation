// 权限管理相关的共享类型（后端 getPermissionAdminView / catalog 的前端镜像）。

export interface PermissionCatalogItem {
  key: string;
  label: string;
}

export interface PermissionCatalogGroup {
  group: string;
  items: PermissionCatalogItem[];
}

export interface PermissionRoleItem {
  key: string;
  label: string;
  privileged?: boolean;
}

export interface PermissionCatalog {
  roles: PermissionRoleItem[];
  menus: PermissionCatalogGroup[];
  actions: PermissionCatalogGroup[];
}

// listRolePermissions / listUserPermissionOverrides 经 toCamelRow 后是 camelCase。
export interface RolePermissionRow {
  role: string;
  resourceType: string;
  resourceKey: string;
  accessLevel: string;
}

export interface UserOverrideRow {
  resourceType: string;
  resourceKey: string;
  accessLevel: string;
}

export interface UserScopeRow {
  resourceType: string;
  resourceId: string;
  accessLevel: string;
}

export interface PermissionAdminView {
  catalog: PermissionCatalog;
  rolePermissions: RolePermissionRow[];
  user: {
    userId: string;
    overrides: UserOverrideRow[];
    scopes: UserScopeRow[];
  } | null;
}

// erp.reports.mallDict() 返回的 malls 项（snake_case，未经 camel 化）。
export interface MallDictItem {
  mall_id: string;
  mall_name?: string;
  store_code?: string | null;
  owner?: string | null;
  status?: string | null;
}

export const PRIVILEGED_ROLES = new Set(["admin", "manager"]);

// 把店铺显示成「temu-037 · 店名」，店号缺失时退化用 mall_id 尾段。
export function formatStoreLabel(mall: MallDictItem): string {
  const code = (mall.store_code || "").trim();
  const name = (mall.mall_name || "").trim();
  const head = code || `#${String(mall.mall_id || "").slice(-4)}`;
  return name ? `${head} · ${name}` : head;
}
