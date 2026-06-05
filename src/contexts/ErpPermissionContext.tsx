import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useErpAuth } from "./ErpAuthContext";
import { canAccessRoute as fallbackCanAccessRoute } from "../utils/erpRoleAccess";

// 「负责的店铺」一项：mall_id + 内部店号 + Temu 店名。
export interface PermissionStore {
  mallId: string;
  storeCode: string;
  mallName: string;
}

// 后端 computeEffectivePermissions 返回的有效权限（已叠加角色 + 用户覆盖）。
export interface EffectivePermissions {
  role: string;
  isPrivileged: boolean;
  allStores: boolean;
  menuKeys: string[];
  actionKeys: string[];
  mallIds: string[];
  stores: PermissionStore[];
}

interface ErpPermissionContextValue {
  effective: EffectivePermissions | null;
  loading: boolean;
  loadedOnce: boolean;
  refresh: () => Promise<void>;
  /** 是否可见 / 可进入某菜单路由 */
  canMenu: (path: string) => boolean;
  /** 是否可执行某操作（actionKey 形如 purchase:delete） */
  can: (actionKey: string) => boolean;
  /** 当前用户负责的店铺 mall_id 列表（admin / manager 为空数组但 allStores=true） */
  myMallIds: string[];
  stores: PermissionStore[];
  isPrivileged: boolean;
}

const ErpPermissionContext = createContext<ErpPermissionContextValue | null>(null);

// 把带参数的路由收敛到 catalog 里的菜单 key，便于按菜单粒度判权限。
function normalizeRoutePath(pathname: string): string {
  if (!pathname) return pathname;
  if (pathname.startsWith("/products/")) return "/products";
  if (pathname.startsWith("/ops-workbench/")) return "/ops-workbench";
  return pathname;
}

export function ErpPermissionProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useErpAuth();
  const [effective, setEffective] = useState<EffectivePermissions | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const userId = currentUser?.id || null;
  const reqSeq = useRef(0);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.erp?.permission;
    if (!api?.getProfile || !userId) {
      setEffective(null);
      setLoadedOnce(true);
      return;
    }
    const seq = reqSeq.current + 1;
    reqSeq.current = seq;
    setLoading(true);
    try {
      const profile = await api.getProfile();
      if (seq !== reqSeq.current) return;
      setEffective((profile?.effective as EffectivePermissions) || null);
    } catch {
      // 拉取失败（如离线 / 旧服务端无 effective 字段）时置空，canMenu 回退到硬编码默认，避免黑屏。
      if (seq !== reqSeq.current) return;
      setEffective(null);
    } finally {
      if (seq === reqSeq.current) {
        setLoading(false);
        setLoadedOnce(true);
      }
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 用户被改了角色 / 权限时，后端会广播 user:update，这里顺带刷新有效权限。
  useEffect(() => {
    const unsubscribe = window.electronAPI?.erp?.events?.onUserUpdate?.((payload: { userId?: string | null }) => {
      if (!payload?.userId || payload.userId === userId) {
        void refresh();
      }
    });
    return unsubscribe;
  }, [refresh, userId]);

  const value = useMemo<ErpPermissionContextValue>(() => {
    const role = currentUser?.role || "";
    const isPrivileged = effective?.isPrivileged ?? (role === "admin" || role === "manager");
    const menuSet = new Set(effective?.menuKeys || []);
    const actionSet = new Set(effective?.actionKeys || []);
    return {
      effective,
      loading,
      loadedOnce,
      refresh,
      isPrivileged,
      myMallIds: effective?.mallIds || [],
      stores: effective?.stores || [],
      canMenu: (path: string) => {
        if (isPrivileged) return true;
        // 有效权限尚未拉到时，回退到硬编码默认（与改造前一致），避免短暂黑屏。
        if (!effective) return fallbackCanAccessRoute(role, path);
        return menuSet.has(normalizeRoutePath(path));
      },
      can: (actionKey: string) => {
        if (isPrivileged) return true;
        if (!effective) return false;
        return actionSet.has(actionKey);
      },
    };
  }, [currentUser?.role, effective, loading, loadedOnce, refresh]);

  return <ErpPermissionContext.Provider value={value}>{children}</ErpPermissionContext.Provider>;
}

export function useErpPermissions() {
  const value = useContext(ErpPermissionContext);
  if (!value) throw new Error("useErpPermissions must be used inside ErpPermissionProvider");
  return value;
}
