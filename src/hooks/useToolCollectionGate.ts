import { useCallback, useEffect, useMemo, useState } from "react";
import {
  COLLECTION_DIAGNOSTICS_KEY,
  normalizeCollectionDiagnostics,
  type CollectionDiagnostics,
} from "../utils/collectionDiagnostics";
import {
  getToolCollectionRequirementState,
  type ToolCollectionRequirementState,
} from "../utils/toolCollectionGate";
import { getStoreValue } from "../utils/storeCompat";
import { useStoreRefresh } from "./useStoreRefresh";

const store = window.electronAPI?.store;

export interface ToolCollectionRequirementViewState extends ToolCollectionRequirementState {
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useToolCollectionRequirement(): ToolCollectionRequirementViewState {
  if (!store) {
    return {
      loading: false,
      active: false,
      allowed: true,
      reason: null,
      lastCollectionAt: null,
      lastCollectionLabel: null,
      refresh: async () => {},
    };
  }

  const [diagnostics, setDiagnostics] = useState<CollectionDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const loadDiagnostics = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await getStoreValue(store, COLLECTION_DIAGNOSTICS_KEY);
      setDiagnostics(normalizeCollectionDiagnostics(raw));
    } catch {
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useStoreRefresh({
    load: loadDiagnostics,
    watchKeys: [COLLECTION_DIAGNOSTICS_KEY],
    enabled: true,
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const requirement = useMemo(
    () => getToolCollectionRequirementState(diagnostics, new Date(now)),
    [diagnostics, now],
  );

  return {
    ...requirement,
    loading,
    refresh: loadDiagnostics,
  };
}
