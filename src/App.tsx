import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/Layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import ShopOverview from "./pages/ShopOverview";
import AccountManager from "./pages/AccountManager";
import ProductList from "./pages/ProductList";
import ProductDetail from "./pages/ProductDetail";
import TaskManager from "./pages/TaskManager";
import Settings from "./pages/Settings";
import ProductCreate from "./pages/ProductCreate";
import { CollectionProvider } from "./contexts/CollectionContext";

function App() {
  return (
    <CollectionProvider>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/shop" replace />} />
          <Route path="shop" element={<ShopOverview />} />
          <Route path="products" element={<ProductList />} />
          <Route path="products/:id" element={<ProductDetail />} />
          <Route path="create-product" element={<ProductCreate />} />
          <Route path="collect" element={<Dashboard />} />
          <Route path="accounts" element={<AccountManager />} />
          <Route path="tasks" element={<TaskManager />} />
          <Route path="settings" element={<Settings />} />
          {/* Legacy routes */}
          <Route path="dashboard" element={<Navigate to="/shop" replace />} />
          <Route path="sales" element={<Navigate to="/products" replace />} />
          <Route path="orders" element={<Navigate to="/products" replace />} />
          <Route path="analytics" element={<Navigate to="/shop" replace />} />
        </Route>
      </Routes>
    </CollectionProvider>
  );
}

export default App;
