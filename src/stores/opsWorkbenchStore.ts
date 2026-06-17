// 运营工作台全局 UI 状态(跨 Tab 共享):目前只放「我的店」owner 过滤——所有 Tab 的 inScope 都依赖它。
// 其余 filter 多为单 Tab 局部状态(useSessionState),拆组件后各 Tab 自持,不进全局 store。
import { create } from "zustand";

const OWNER_KEY = "ow_owner";

interface OpsWorkbenchState {
  ownerFilter: string;
  setOwnerFilter: (v: string) => void;
}

export const useOpsWorkbenchStore = create<OpsWorkbenchState>((set) => ({
  ownerFilter: (() => { try { return localStorage.getItem(OWNER_KEY) || "all"; } catch { return "all"; } })(),
  setOwnerFilter: (v) => {
    try { localStorage.setItem(OWNER_KEY, v); } catch { /* */ }
    set({ ownerFilter: v });
  },
}));
