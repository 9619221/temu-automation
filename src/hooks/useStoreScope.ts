// 字典共享:店铺健康(shopHealth)经 SWR 全局只拉一次,派生 owner 映射 + 「我的店」过滤。
// 原 OperationsWorkbench 里 storeOwnerMap/ownerOptions/inScope 内联且各处重复遍历 shopRows;
// 抽成单一 hook 后,任何 Tab 组件 useStoreScope() 即拿到一致的 owner 过滤能力,shopHealth 不重复请求。
import { useCallback, useMemo } from "react";
import { useShopHealth } from "./useOpsReports";
import { useOpsWorkbenchStore } from "../stores/opsWorkbenchStore";

export function useStoreScope() {
  const { rows: shopRows, loading: shopLoading, reload: reloadShop } = useShopHealth();
  const ownerFilter = useOpsWorkbenchStore((s) => s.ownerFilter);

  // store_code / mall_id → owner 映射(来自店铺健康),用于「我的店」过滤
  const storeOwnerMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of shopRows) {
      if (!r.owner) continue;
      if (r.store_code) m.set(r.store_code, r.owner);
      if (r.mall_id) m.set(r.mall_id, r.owner);
    }
    return m;
  }, [shopRows]);

  const ownerOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of shopRows) if (r.owner) s.add(r.owner);
    return Array.from(s).sort();
  }, [shopRows]);

  // 当前 owner 视角下该店是否可见;选了具体 owner 但映射还没到(shop未加载)时不误杀,放行
  const inScope = useCallback((code: string | null | undefined) => {
    if (ownerFilter === "all") return true;
    if (storeOwnerMap.size === 0) return true;
    return storeOwnerMap.get(code || "") === ownerFilter;
  }, [ownerFilter, storeOwnerMap]);

  return { shopRows, shopLoading, reloadShop, storeOwnerMap, ownerOptions, inScope, ownerFilter };
}
