import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { CollectionProvider } from "./contexts/CollectionContext";
import { ErpAuthProvider, useErpAuth } from "./contexts/ErpAuthContext";
import { canAccessRoute, getDefaultPathForRole, roleLabel } from "./utils/erpRoleAccess";
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
const ProductList = lazy(() => import("./pages/ProductList.tsx"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const Settings = lazy(() => import("./pages/Settings"));
const ProductCreate = lazy(() => import("./pages/ProductCreate"));
const ImageStudio = lazy(() => import("./pages/ImageStudio"));
const ImageStudioGPT = lazy(() => import("./pages/ImageStudioGPT"));
const Logs = lazy(() => import("./pages/Logs"));
const CompetitorAnalysis = lazy(() => import("./pages/CompetitorAnalysis"));
const PriceReview = lazy(() => import("./pages/PriceReview"));
const ErpDebug = lazy(() => import("./pages/ErpDebug"));
const DailyCommandCenter = lazy(() => import("./pages/DailyCommandCenter"));
const ProductMasterData = lazy(() => import("./pages/ProductMasterData"));
const PurchaseCenter = lazy(() => import("./pages/PurchaseCenter"));
const AlibabaMapping = lazy(() => import("./pages/AlibabaMapping"));
const WarehouseCenter = lazy(() => import("./pages/WarehouseCenter"));
const QcOutboundCenter = lazy(() => import("./pages/QcOutboundCenter"));
const WorkItems = lazy(() => import("./pages/WorkItems"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const ErpLogin = lazy(() => import("./pages/ErpLogin"));

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

function RequireAuth({ children }: { children: JSX.Element }) {
  const auth = useErpAuth();
  const location = useLocation();

  if (auth.loading) return <RouteLoading />;
  if (!auth.currentUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function RoleHomeRedirect() {
  const { currentUser } = useErpAuth();
  return <Navigate to={getDefaultPathForRole(currentUser?.role)} replace />;
}

function AccessDenied() {
  const { currentUser } = useErpAuth();
  return (
    <div
      style={{
        minHeight: 360,
        display: "grid",
        placeItems: "center",
        background: "#fff",
        borderRadius: 10,
        border: "1px solid #eef0f5",
      }}
    >
      <div style={{ textAlign: "center", padding: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>无权访问</div>
        <div style={{ color: "#667085", marginBottom: 16 }}>
          当前角色：{roleLabel(currentUser?.role)}。请切换到有权限的账号。
        </div>
      </div>
    </div>
  );
}

function RoleRoute({ path, children }: { path: string; children: JSX.Element }) {
  const { currentUser } = useErpAuth();
  if (!canAccessRoute(currentUser?.role, path)) return <AccessDenied />;
  return children;
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
        emitActiveAccountChanged(null);
        return;
      }

      if (activeAccountId && accounts.some((account: { id?: string }) => account?.id === activeAccountId)) {
        await syncScopedDataToGlobalStore(store, activeAccountId);
        emitActiveAccountChanged(activeAccountId);
        return;
      }

      if (activeAccountId) {
        await writeActiveAccountId(store, null);
        emitActiveAccountChanged(null);
      }
      await syncScopedDataToGlobalStore(store, null);
      emitActiveAccountChanged(null);
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
    <ErpAuthProvider>
      <CollectionProvider key={`collection-${accountViewVersion}`}>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/login" element={<ErpLogin />} />
            <Route
              path="/"
              element={(
                <RequireAuth>
                  <AppLayout key={`layout-${accountViewVersion}`} />
                </RequireAuth>
              )}
            >
            <Route index element={<RoleHomeRedirect />} />
            <Route path="shop" element={<RoleRoute path="/shop"><ShopOverview /></RoleRoute>} />
            <Route path="products" element={<RoleRoute path="/products"><ProductList /></RoleRoute>} />
            <Route path="products/:id" element={<RoleRoute path="/products"><ProductDetail /></RoleRoute>} />
            <Route path="create-product" element={<RoleRoute path="/create-product"><ProductCreate /></RoleRoute>} />
            <Route path="product-create" element={<Navigate to="/create-product" replace />} />
            <Route path="image-studio" element={<RoleRoute path="/image-studio"><ImageStudio /></RoleRoute>} />
            <Route path="image-studio-gpt" element={<RoleRoute path="/image-studio-gpt"><ImageStudioGPT /></RoleRoute>} />
            <Route path="collect" element={<RoleRoute path="/collect"><Dashboard /></RoleRoute>} />
            <Route path="accounts" element={<RoleRoute path="/accounts"><AccountManager /></RoleRoute>} />
            <Route path="tasks" element={<Navigate to="/work-items" replace />} />
            <Route path="competitor" element={<RoleRoute path="/competitor"><CompetitorAnalysis /></RoleRoute>} />
            <Route path="price-review" element={<RoleRoute path="/price-review"><PriceReview /></RoleRoute>} />
            <Route path="daily-command" element={<RoleRoute path="/daily-command"><DailyCommandCenter /></RoleRoute>} />
            <Route path="product-master-data" element={<RoleRoute path="/product-master-data"><ProductMasterData mode="skus" /></RoleRoute>} />
            <Route path="stores" element={<RoleRoute path="/stores"><ProductMasterData mode="stores" /></RoleRoute>} />
            <Route path="1688-mapping" element={<RoleRoute path="/1688-mapping"><AlibabaMapping /></RoleRoute>} />
            <Route path="purchase-center" element={<RoleRoute path="/purchase-center"><PurchaseCenter /></RoleRoute>} />
            <Route path="warehouse-center" element={<RoleRoute path="/warehouse-center"><WarehouseCenter /></RoleRoute>} />
            <Route path="qc-outbound" element={<RoleRoute path="/qc-outbound"><QcOutboundCenter /></RoleRoute>} />
            <Route path="work-items" element={<RoleRoute path="/work-items"><WorkItems /></RoleRoute>} />
            <Route path="users" element={<RoleRoute path="/users"><UserManagement /></RoleRoute>} />
            <Route path="erp-debug" element={<RoleRoute path="/erp-debug"><ErpDebug /></RoleRoute>} />
            <Route path="logs" element={<RoleRoute path="/logs"><Logs /></RoleRoute>} />
            <Route path="settings" element={<RoleRoute path="/settings"><Settings /></RoleRoute>} />
            {/* Legacy routes */}
            <Route path="dashboard" element={<Navigate to="/shop" replace />} />
            <Route path="sales" element={<Navigate to="/products" replace />} />
            <Route path="orders" element={<Navigate to="/products" replace />} />
            <Route path="analytics" element={<Navigate to="/shop" replace />} />
          </Route>
          </Routes>
        </Suspense>
      </CollectionProvider>
    </ErpAuthProvider>
  );
}

export default App;
