import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { CollectionProvider } from "./contexts/CollectionContext";
import {
  ACTIVE_ACCOUNT_CHANGED_EVENT,
  emitActiveAccountChanged,
  readActiveAccountId,
  syncScopedDataToGlobalStore,
  writeActiveAccountId,
} from "./utils/multiStore";

const ACCOUNT_STORAGE_KEY = "temu_accounts";

const AppLayout = lazy(() => import("./components/Layout/AppLayout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ShopOverview = lazy(() => import("./pages/ShopOverview"));
const AccountManager = lazy(() => import("./pages/AccountManager"));
const ProductList = lazy(() => import("./pages/ProductList"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const TaskManager = lazy(() => import("./pages/TaskManager"));
const Settings = lazy(() => import("./pages/Settings"));
const ProductCreate = lazy(() => import("./pages/ProductCreate"));
const ImageStudio = lazy(() => import("./pages/ImageStudio"));
const Logs = lazy(() => import("./pages/Logs"));

function RouteLoading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "#f0f2f5",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "4px solid #d9d9d9",
          borderTopColor: "#1677ff",
          animation: "temu-route-loading-spin 0.8s linear infinite",
        }}
      />
      <span style={{ color: "#8c8c8c", fontSize: 14 }}>正在加载页面...</span>
      <style>
        {`
          @keyframes temu-route-loading-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
}

function App() {
  const [accountViewVersion, setAccountViewVersion] = useState(0);
  const lastEmittedAccountIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const store = window.electronAPI?.store;
    if (!store) return;

    let cancelled = false;

    const restoreActiveAccountData = async () => {
      const accounts = await store.get(ACCOUNT_STORAGE_KEY);
      if (cancelled) return;

      const activeAccountId = await readActiveAccountId(store);
      if (cancelled) return;
      lastEmittedAccountIdRef.current = activeAccountId;

      if (!Array.isArray(accounts) || accounts.length === 0) {
        if (activeAccountId) {
          await writeActiveAccountId(store, null);
          emitActiveAccountChanged(null);
        }
        await syncScopedDataToGlobalStore(store, null);
        return;
      }

      if (activeAccountId && accounts.some((account: { id?: string }) => account?.id === activeAccountId)) {
        await syncScopedDataToGlobalStore(store, activeAccountId);
        return;
      }

      if (activeAccountId) {
        await writeActiveAccountId(store, null);
        emitActiveAccountChanged(null);
      }
      await syncScopedDataToGlobalStore(store, null);
    };

    restoreActiveAccountData().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleActiveAccountChanged = (event: Event) => {
      const nextAccountId = (event as CustomEvent<{ accountId?: string | null }>)?.detail?.accountId ?? null;
      if (lastEmittedAccountIdRef.current === nextAccountId) {
        return;
      }
      lastEmittedAccountIdRef.current = nextAccountId;
      setAccountViewVersion((prev) => prev + 1);
    };

    window.addEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged as EventListener);
    return () => {
      window.removeEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged as EventListener);
    };
  }, []);

  return (
    <CollectionProvider key={`collection-${accountViewVersion}`}>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<AppLayout key={`layout-${accountViewVersion}`} />}>
            <Route index element={<Navigate to="/shop" replace />} />
            <Route path="shop" element={<ShopOverview />} />
            <Route path="products" element={<ProductList />} />
            <Route path="products/:id" element={<ProductDetail />} />
            <Route path="create-product" element={<ProductCreate />} />
            <Route path="image-studio" element={<ImageStudio />} />
            <Route path="collect" element={<Dashboard />} />
            <Route path="accounts" element={<AccountManager />} />
            <Route path="tasks" element={<TaskManager />} />
            <Route path="logs" element={<Logs />} />
            <Route path="settings" element={<Settings />} />
            {/* Legacy routes */}
            <Route path="dashboard" element={<Navigate to="/shop" replace />} />
            <Route path="sales" element={<Navigate to="/products" replace />} />
            <Route path="orders" element={<Navigate to="/products" replace />} />
            <Route path="analytics" element={<Navigate to="/shop" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </CollectionProvider>
  );
}

export default App;
