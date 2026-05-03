import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ErpSessionUser } from "../utils/erpRoleAccess";

interface ErpAuthStatus {
  hasUsers: boolean;
  currentUser: ErpSessionUser | null;
}

const LOGIN_SERVICE_UNAVAILABLE = "登录服务暂不可用，请稍后重试";

function normalizeAuthError(error: unknown, fallback = LOGIN_SERVICE_UNAVAILABLE): Error {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  if (!rawMessage) return new Error(fallback);

  if (rawMessage.includes("No handler registered")) {
    return new Error(LOGIN_SERVICE_UNAVAILABLE);
  }

  const remoteMethodMatch = rawMessage.match(/Error invoking remote method '[^']+':\s*Error:\s*(.+)$/);
  if (remoteMethodMatch?.[1]) {
    return new Error(remoteMethodMatch[1]);
  }

  return error instanceof Error ? error : new Error(rawMessage);
}

interface ErpAuthContextValue extends ErpAuthStatus {
  loading: boolean;
  apiReady: boolean;
  refresh: () => Promise<ErpAuthStatus | null>;
  login: (payload: { login: string; accessCode: string; serverUrl?: string }) => Promise<ErpAuthStatus>;
  createFirstAdmin: (payload: { name: string; accessCode: string }) => Promise<ErpAuthStatus>;
  logout: () => Promise<ErpAuthStatus>;
}

const defaultStatus: ErpAuthStatus = {
  hasUsers: true,
  currentUser: null,
};

const ErpAuthContext = createContext<ErpAuthContextValue | null>(null);

function normalizeStatus(status: ErpAuthStatus | null | undefined): ErpAuthStatus {
  return {
    hasUsers: Boolean(status?.hasUsers),
    currentUser: status?.currentUser || null,
  };
}

export function ErpAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ErpAuthStatus>(defaultStatus);
  const [loading, setLoading] = useState(true);
  const [apiReady, setApiReady] = useState(Boolean(window.electronAPI?.erp?.auth));

  const getAuthApi = useCallback(() => window.electronAPI?.erp?.auth, []);

  const refresh = useCallback(async () => {
    const authApi = getAuthApi();
    setApiReady(Boolean(authApi));
    if (!authApi) {
      setStatus(defaultStatus);
      setLoading(false);
      return defaultStatus;
    }
    setLoading(true);
    try {
      const nextStatus = normalizeStatus(await authApi.getStatus());
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setLoading(false);
    }
  }, [getAuthApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (payload: { login: string; accessCode: string; serverUrl?: string }) => {
    const authApi = getAuthApi();
    setApiReady(Boolean(authApi));
    if (!authApi) throw new Error(LOGIN_SERVICE_UNAVAILABLE);
    try {
      const nextStatus = normalizeStatus(await authApi.login(payload));
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      throw normalizeAuthError(error);
    }
  }, [getAuthApi]);

  const createFirstAdmin = useCallback(async (payload: { name: string; accessCode: string }) => {
    const authApi = getAuthApi();
    setApiReady(Boolean(authApi));
    if (!authApi) throw new Error(LOGIN_SERVICE_UNAVAILABLE);
    try {
      const nextStatus = normalizeStatus(await authApi.createFirstAdmin(payload));
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      throw normalizeAuthError(error, "管理员创建失败");
    }
  }, [getAuthApi]);

  const logout = useCallback(async () => {
    const authApi = getAuthApi();
    setApiReady(Boolean(authApi));
    if (!authApi) throw new Error(LOGIN_SERVICE_UNAVAILABLE);
    try {
      const nextStatus = normalizeStatus(await authApi.logout());
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      throw normalizeAuthError(error, "退出登录失败");
    }
  }, [getAuthApi]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.erp?.events?.onAuthExpired?.(() => {
      setStatus(defaultStatus);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.erp?.events?.onUserUpdate?.((payload: { userId?: string | null; status?: string | null }) => {
      if (!payload?.userId || payload.userId !== status.currentUser?.id) return;
      if (payload.status && payload.status !== "active") {
        void logout();
        return;
      }
      void refresh();
    });
    return unsubscribe;
  }, [logout, refresh, status.currentUser?.id]);

  const value = useMemo<ErpAuthContextValue>(() => ({
    ...status,
    loading,
    apiReady,
    refresh,
    login,
    createFirstAdmin,
    logout,
  }), [apiReady, createFirstAdmin, loading, login, logout, refresh, status]);

  return (
    <ErpAuthContext.Provider value={value}>
      {children}
    </ErpAuthContext.Provider>
  );
}

export function useErpAuth() {
  const value = useContext(ErpAuthContext);
  if (!value) throw new Error("useErpAuth must be used inside ErpAuthProvider");
  return value;
}
