import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { message, notification } from "antd";
import { parseDashboardData, parseProductsData, parseOrdersData, parseSalesData, parseFluxData } from "../utils/parseRawApis";
import {
  COLLECTION_DIAGNOSTICS_KEY,
  normalizeCollectionDiagnostics,
  type CollectionTaskDiagnostic,
} from "../utils/collectionDiagnostics";
import { setStoreValueForActiveAccount } from "../utils/multiStore";

const api = window.electronAPI?.automation;
const store = window.electronAPI?.store;

const PARSED_TASK_KEYS = new Set(["dashboard", "products", "orders", "sales", "flux"]);

export interface CollectTask {
  key: string;
  label: string;
  storeKey: string;
  category: string;
}

// 全部65个采集任务（不含 icon，icon 在 UI 层处理）
export const COLLECT_TASKS: CollectTask[] = [
  { key: "dashboard", label: "仪表盘概览", storeKey: "temu_dashboard", category: "核心数据" },
  { key: "products", label: "商品列表", storeKey: "temu_products", category: "核心数据" },
  { key: "orders", label: "备货单", storeKey: "temu_orders", category: "核心数据" },
  { key: "sales", label: "销售数据", storeKey: "temu_sales", category: "核心数据" },
  { key: "salesChart", label: "销售图表", storeKey: "temu_raw_salesChart", category: "核心数据" },
  { key: "flux", label: "流量分析", storeKey: "temu_flux", category: "核心数据" },
  { key: "goodsData", label: "商品数据", storeKey: "temu_raw_goodsData", category: "商品数据" },
  { key: "lifecycle", label: "上新生命周期", storeKey: "temu_raw_lifecycle", category: "商品数据" },
  { key: "yunduOverall", label: "已加站点+处罚", storeKey: "temu_raw_yunduOverall", category: "商品数据" },
  { key: "globalPerformance", label: "全球销量+地区明细", storeKey: "temu_raw_globalPerformance", category: "商品数据" },
  { key: "yunduActivityList", label: "可报活动列表", storeKey: "temu_raw_yunduActivityList", category: "销售管理" },
  { key: "yunduQualityMetrics", label: "供应链质量指标", storeKey: "temu_raw_yunduQualityMetrics", category: "售后质量" },
  { key: "imageTask", label: "商品图片任务", storeKey: "temu_raw_imageTask", category: "商品数据" },
  { key: "sampleManage", label: "样品管理", storeKey: "temu_raw_sampleManage", category: "商品数据" },
  { key: "activity", label: "活动数据", storeKey: "temu_raw_activity", category: "销售管理" },
  { key: "activityLog", label: "活动日志", storeKey: "temu_raw_activityLog", category: "销售管理" },
  { key: "activityUS", label: "美国活动", storeKey: "temu_raw_activityUS", category: "销售管理" },
  { key: "activityEU", label: "欧盟活动", storeKey: "temu_raw_activityEU", category: "销售管理" },
  { key: "chanceGoods", label: "机会商品", storeKey: "temu_raw_chanceGoods", category: "销售管理" },
  { key: "marketingActivity", label: "营销活动", storeKey: "temu_raw_marketingActivity", category: "销售管理" },
  { key: "urgentOrders", label: "紧急备货", storeKey: "temu_raw_urgentOrders", category: "订单物流" },
  { key: "shippingDesk", label: "发货台", storeKey: "temu_raw_shippingDesk", category: "订单物流" },
  { key: "shippingList", label: "发货单列表", storeKey: "temu_raw_shippingList", category: "订单物流" },
  { key: "addressManage", label: "发退货地址", storeKey: "temu_raw_addressManage", category: "订单物流" },
  { key: "delivery", label: "发货考核", storeKey: "temu_raw_delivery", category: "订单物流" },
  { key: "returnOrders", label: "退货单", storeKey: "temu_raw_returnOrders", category: "退货管理" },
  { key: "returnDetail", label: "退货详情", storeKey: "temu_raw_returnDetail", category: "退货管理" },
  { key: "salesReturn", label: "销售退货", storeKey: "temu_raw_salesReturn", category: "退货管理" },
  { key: "returnReceipt", label: "退货收据", storeKey: "temu_raw_returnReceipt", category: "退货管理" },
  { key: "exceptionNotice", label: "收货异常", storeKey: "temu_raw_exceptionNotice", category: "退货管理" },
  { key: "afterSales", label: "售后数据", storeKey: "temu_raw_afterSales", category: "售后质量" },
  { key: "soldout", label: "售罄分析", storeKey: "temu_raw_soldout", category: "订单物流" },
  { key: "performance", label: "履约表现", storeKey: "temu_raw_performance", category: "订单物流" },
  { key: "checkup", label: "体检中心", storeKey: "temu_raw_checkup", category: "售后质量" },
  { key: "qualityDashboard", label: "质量看板", storeKey: "temu_raw_qualityDashboard", category: "售后质量" },
  { key: "qualityDashboardEU", label: "欧盟质量看板", storeKey: "temu_raw_qualityDashboardEU", category: "售后质量" },
  { key: "qcDetail", label: "质检详情", storeKey: "temu_raw_qcDetail", category: "售后质量" },
  { key: "priceReport", label: "商品价格申报", storeKey: "temu_raw_priceReport", category: "价格管理" },
  { key: "priceCompete", label: "竞价邀请", storeKey: "temu_raw_priceCompete", category: "价格管理" },
  { key: "flowPrice", label: "商品流量视角", storeKey: "temu_raw_flowPrice", category: "价格管理" },
  { key: "retailPrice", label: "建议零售价", storeKey: "temu_raw_retailPrice", category: "价格管理" },
  { key: "mallFlux", label: "店铺流量", storeKey: "temu_raw_mallFlux", category: "流量分析" },
  { key: "mallFluxEU", label: "欧盟店铺流量", storeKey: "temu_raw_mallFluxEU", category: "流量分析" },
  { key: "mallFluxUS", label: "美国店铺流量", storeKey: "temu_raw_mallFluxUS", category: "流量分析" },
  { key: "fluxEU", label: "欧盟流量", storeKey: "temu_raw_fluxEU", category: "流量分析" },
  { key: "fluxUS", label: "美国流量", storeKey: "temu_raw_fluxUS", category: "流量分析" },
  { key: "flowGrow", label: "流量增长", storeKey: "temu_raw_flowGrow", category: "流量分析" },
  { key: "governDashboard", label: "合规看板", storeKey: "temu_raw_governDashboard", category: "合规中心" },
  { key: "governProductQualification", label: "商品资质", storeKey: "temu_raw_governProductQualification", category: "合规中心" },
  { key: "governQualificationAppeal", label: "资质上传申诉", storeKey: "temu_raw_governQualificationAppeal", category: "合规中心" },
  { key: "governEprQualification", label: "EPR资质", storeKey: "temu_raw_governEprQualification", category: "合规中心" },
  { key: "governProductPhoto", label: "商品实拍图", storeKey: "temu_raw_governProductPhoto", category: "合规中心" },
  { key: "governComplianceInfo", label: "商品合规信息", storeKey: "temu_raw_governComplianceInfo", category: "合规中心" },
  { key: "governResponsiblePerson", label: "生产者延伸责任", storeKey: "temu_raw_governResponsiblePerson", category: "合规中心" },
  { key: "governManufacturer", label: "制造商信息", storeKey: "temu_raw_governManufacturer", category: "合规中心" },
  { key: "governComplaint", label: "投诉处理", storeKey: "temu_raw_governComplaint", category: "合规中心" },
  { key: "governViolationAppeal", label: "违规申诉", storeKey: "temu_raw_governViolationAppeal", category: "合规中心" },
  { key: "governMerchantAppeal", label: "商家申诉", storeKey: "temu_raw_governMerchantAppeal", category: "合规中心" },
  { key: "governTro", label: "临时限制令", storeKey: "temu_raw_governTro", category: "合规中心" },
  { key: "governEprBilling", label: "EPR计费", storeKey: "temu_raw_governEprBilling", category: "合规中心" },
  { key: "governComplianceReference", label: "合规性参考", storeKey: "temu_raw_governComplianceReference", category: "合规中心" },
  { key: "governCustomsAttribute", label: "清关属性维护", storeKey: "temu_raw_governCustomsAttribute", category: "合规中心" },
  { key: "governCategoryCorrection", label: "类目纠正", storeKey: "temu_raw_governCategoryCorrection", category: "合规中心" },
  { key: "adsHome", label: "推广首页", storeKey: "temu_raw_adsHome", category: "广告推广" },
  { key: "adsProduct", label: "商品推广", storeKey: "temu_raw_adsProduct", category: "广告推广" },
  { key: "adsReport", label: "数据报表", storeKey: "temu_raw_adsReport", category: "广告推广" },
  { key: "adsFinance", label: "财务管理", storeKey: "temu_raw_adsFinance", category: "广告推广" },
  { key: "adsHelp", label: "帮助中心", storeKey: "temu_raw_adsHelp", category: "广告推广" },
  { key: "adsNotification", label: "消息通知", storeKey: "temu_raw_adsNotification", category: "广告推广" },
  { key: "usRetrieval", label: "美国召回", storeKey: "temu_raw_usRetrieval", category: "其他" },
];

export const TASK_CATEGORIES = Array.from(new Set(COLLECT_TASKS.map(t => t.category)));

export type TaskStatus = "pending" | "running" | "success" | "error";

export interface TaskState {
  status: TaskStatus;
  message?: string;
  count?: number;
  duration?: number;
}

function openCollectionNotification(successCount: number, errorCount: number, elapsed: number) {
  const title = errorCount > 0 ? "采集完成，部分任务失败" : "采集完成";
  const description = [
    `${successCount} 项成功`,
    errorCount > 0 ? `${errorCount} 项失败` : "",
    elapsed > 0 ? `总耗时 ${elapsed} 秒` : "",
  ].filter(Boolean).join("，");

  notification[errorCount > 0 ? "warning" : "success"]({
    message: title,
    description,
    duration: 5,
    placement: "bottomRight",
  });
}

interface CollectionContextType {
  collecting: boolean;
  taskStates: Record<string, TaskState>;
  progress: number;
  elapsed: number;
  successCount: number;
  errorCount: number;
  startCollectAll: () => void;
  cancelCollection: () => void;
  startSyncDashboard: () => void;
  syncingDashboard: boolean;
}

const CollectionContext = createContext<CollectionContextType>({
  collecting: false,
  taskStates: {},
  progress: 0,
  elapsed: 0,
  successCount: 0,
  errorCount: 0,
  startCollectAll: () => {},
  cancelCollection: () => {},
  startSyncDashboard: () => {},
  syncingDashboard: false,
});

export function useCollection() {
  return useContext(CollectionContext);
}

export function CollectionProvider({ children }: { children: React.ReactNode }) {
  const [collecting, setCollecting] = useState(false);
  const [taskStates, setTaskStates] = useState<Record<string, TaskState>>({});
  const [progress, setProgress] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [syncingDashboard, setSyncingDashboard] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const collectionRunRef = useRef(0);

  // 计时器
  useEffect(() => {
    if (!collecting) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [collecting, startTime]);

  useEffect(() => {
    if (!collecting || !api?.getScrapeProgress) return;

    const runId = collectionRunRef.current;
    let cancelled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const syncProgress = async () => {
      try {
        const snapshot = await api.getScrapeProgress();
        if (cancelled || collectionRunRef.current !== runId) return;

        if (snapshot?.running && snapshot?.tasks && typeof snapshot.tasks === "object") {
          setTaskStates((prev) => {
            const next = { ...prev };
            for (const task of COLLECT_TASKS) {
              const remoteTask = snapshot.tasks?.[task.key];
              if (!remoteTask) {
                if (!next[task.key]) next[task.key] = { status: "pending" };
                continue;
              }
              next[task.key] = {
                ...next[task.key],
                status: remoteTask.status || next[task.key]?.status || "pending",
                message: typeof remoteTask.message === "string" ? remoteTask.message : next[task.key]?.message,
                duration: typeof remoteTask.duration === "number" ? remoteTask.duration : next[task.key]?.duration,
              };
            }
            return next;
          });

          const totalTasks = Number(snapshot.totalTasks) || COLLECT_TASKS.length;
          const completedTasks = Number(snapshot.completedTasks) || 0;
          setProgress(Math.min(95, Math.round((completedTasks / Math.max(1, totalTasks)) * 100)));
        }
      } catch {}

      if (!cancelled && collectionRunRef.current === runId) {
        timeoutId = setTimeout(syncProgress, 1000);
      }
    };

    syncProgress().catch(() => {});

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [collecting]);

  const successCount = Object.values(taskStates).filter(t => t.status === "success").length;
  const errorCount = Object.values(taskStates).filter(t => t.status === "error").length;

  const startCollectAll = useCallback(async () => {
    if (!api || collecting) return;
    const runId = collectionRunRef.current + 1;
    collectionRunRef.current = runId;
    const isCancelled = () => collectionRunRef.current !== runId;
    const startedAtMs = Date.now();

    setCollecting(true);
    setStartTime(startedAtMs);
    setElapsed(0);
    setProgress(0);

    const initStates: Record<string, TaskState> = {};
    COLLECT_TASKS.forEach(t => { initStates[t.key] = { status: "pending", message: "排队中" }; });
    setTaskStates(initStates);

    const syncedAt = new Date().toLocaleString("zh-CN");
    const diagnosticsTasks: Record<string, CollectionTaskDiagnostic> = {};

    try {
      const allResults: any = await api.scrapeAll();
      if (isCancelled()) return;

      let completed = 0;
      for (const task of COLLECT_TASKS) {
        if (isCancelled()) return;
        const r = allResults[task.key];
        if (r && r.success) {
          try {
            const data = await api.readScrapeData(task.key);
            if (isCancelled()) return;
            if (data === null || data === undefined) {
              throw new Error("采集结果文件为空或未生成");
            }
            const count = data?.apis?.length || 0;

            let storeData: any = data;
            if (PARSED_TASK_KEYS.has(task.key)) {
              if (task.key === "dashboard") storeData = parseDashboardData(data);
              else if (task.key === "products") storeData = parseProductsData(data);
              else if (task.key === "orders") storeData = parseOrdersData(data);
              else if (task.key === "sales") storeData = parseSalesData(data);
              else if (task.key === "flux") storeData = parseFluxData(data);

              if (Array.isArray(storeData)) {
                await setStoreValueForActiveAccount(store, task.storeKey, storeData);
              } else if (typeof storeData === "object" && storeData !== null) {
                await setStoreValueForActiveAccount(store, task.storeKey, { ...storeData, syncedAt });
              } else {
                await setStoreValueForActiveAccount(store, task.storeKey, storeData);
              }
            } else {
              await setStoreValueForActiveAccount(store, task.storeKey, { ...data, syncedAt });
            }

            const displayCount = !PARSED_TASK_KEYS.has(task.key) ? count
              : task.key === "products" ? (Array.isArray(storeData) ? storeData.length : count)
              : task.key === "orders" ? (Array.isArray(storeData) ? storeData.length : count)
              : task.key === "sales" ? (storeData?.items?.length || count)
              : count;

            diagnosticsTasks[task.key] = {
              status: "success",
              storeKey: task.storeKey,
              updatedAt: syncedAt,
              count: displayCount,
              duration: r.duration,
              message: `${displayCount} 条数据`,
            };

            setTaskStates(prev => ({ ...prev, [task.key]: {
              status: "success", count: displayCount, duration: r.duration, message: `${displayCount} 条数据`
            }}));
          } catch (error: any) {
            if (isCancelled()) return;
            const detail = error?.message || "读取采集结果失败";
            diagnosticsTasks[task.key] = {
              status: "error",
              storeKey: task.storeKey,
              updatedAt: syncedAt,
              duration: r.duration,
              message: detail.substring(0, 50),
            };
            setTaskStates(prev => ({ ...prev, [task.key]: {
              status: "error", duration: r.duration, message: detail.substring(0, 50)
            }}));
          }
        } else if (r) {
          if (isCancelled()) return;
          diagnosticsTasks[task.key] = {
            status: "error",
            storeKey: task.storeKey,
            updatedAt: syncedAt,
            duration: r.duration,
            message: r.error?.substring(0, 50) || "未知错误",
          };
          setTaskStates(prev => ({ ...prev, [task.key]: {
            status: "error", duration: r.duration, message: r.error?.substring(0, 50) || "未知错误"
          }}));
        } else {
          if (isCancelled()) return;
          diagnosticsTasks[task.key] = {
            status: "error",
            storeKey: task.storeKey,
            updatedAt: syncedAt,
            message: "未收到采集结果",
          };
          setTaskStates(prev => ({ ...prev, [task.key]: {
            status: "error", message: "未收到采集结果"
          }}));
        }
        completed++;
        setProgress(Math.round((completed / COLLECT_TASKS.length) * 100));
      }

      if (isCancelled()) return;
      const successTotal = Object.values(diagnosticsTasks).filter((task) => task.status === "success").length;
      const errorTotal = Object.values(diagnosticsTasks).filter((task) => task.status === "error").length;
      const finalElapsed = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      openCollectionNotification(successTotal, errorTotal, finalElapsed);
    } catch (e: any) {
      if (isCancelled()) return;
      notification.error({
        message: "采集失败",
        description: e.message || "采集过程中出现异常",
        duration: 5,
        placement: "bottomRight",
      });
      COLLECT_TASKS.forEach(t => {
        diagnosticsTasks[t.key] = {
          status: "error",
          storeKey: t.storeKey,
          updatedAt: syncedAt,
          message: e.message?.substring(0, 50) || "采集失败",
        };
        setTaskStates(prev => ({ ...prev, [t.key]: { status: "error", message: e.message?.substring(0, 50) }}));
      });
      setProgress(100);
    }

    if (isCancelled()) return;
    if (store) {
      try {
        const successTotal = Object.values(diagnosticsTasks).filter((task) => task.status === "success").length;
        const errorTotal = Object.values(diagnosticsTasks).filter((task) => task.status === "error").length;
        await setStoreValueForActiveAccount(store, COLLECTION_DIAGNOSTICS_KEY, {
          syncedAt,
          tasks: diagnosticsTasks,
          summary: {
            totalTasks: COLLECT_TASKS.length,
            successCount: successTotal,
            errorCount: errorTotal,
          },
        });
      } catch {}
    }

    if (isCancelled()) return;
    setCollecting(false);
  }, [collecting]);

  const startSyncDashboard = useCallback(async () => {
    if (!api || syncingDashboard) return;
    setSyncingDashboard(true);
    setTaskStates((prev) => ({
      ...prev,
      dashboard: {
        status: "running",
        message: "正在同步仪表盘数据",
      },
    }));
    try {
      const res = await api.scrapeDashboard();
      const raw = (res as any)?.dashboard || res;
      const data = parseDashboardData(raw);
      const syncedAt = new Date().toLocaleString("zh-CN");
      await setStoreValueForActiveAccount(store, "temu_dashboard", { ...data, syncedAt });
      if (store) {
        try {
          const current = normalizeCollectionDiagnostics(await store.get(COLLECTION_DIAGNOSTICS_KEY));
          await setStoreValueForActiveAccount(store, COLLECTION_DIAGNOSTICS_KEY, {
            ...current,
            syncedAt,
            tasks: {
              ...current.tasks,
              dashboard: {
                status: "success",
                storeKey: "temu_dashboard",
                updatedAt: syncedAt,
                message: "仪表盘数据已同步",
              },
            },
            summary: {
              totalTasks: Math.max(current.summary.totalTasks, COLLECT_TASKS.length),
              successCount: Object.values({
                ...current.tasks,
                dashboard: {
                  status: "success",
                  storeKey: "temu_dashboard",
                  updatedAt: syncedAt,
                  message: "仪表盘数据已同步",
                },
              }).filter((task) => task.status === "success").length,
              errorCount: Object.values({
                ...current.tasks,
                dashboard: {
                  status: "success",
                  storeKey: "temu_dashboard",
                  updatedAt: syncedAt,
                  message: "仪表盘数据已同步",
                },
              }).filter((task) => task.status === "error").length,
            },
          });
        } catch {}
      }
      setTaskStates((prev) => ({
        ...prev,
        dashboard: {
          status: "success",
          message: "仪表盘数据已同步",
        },
      }));
      message.success("仪表盘数据同步成功!");
    } catch (e: any) {
      const detail = e?.message?.substring(0, 50) || "同步失败";
      const updatedAt = new Date().toLocaleString("zh-CN");
      if (store) {
        try {
          const current = normalizeCollectionDiagnostics(await store.get(COLLECTION_DIAGNOSTICS_KEY));
          const nextTasks = {
            ...current.tasks,
            dashboard: {
              status: "error",
              storeKey: "temu_dashboard",
              updatedAt,
              message: detail,
            },
          };
          await setStoreValueForActiveAccount(store, COLLECTION_DIAGNOSTICS_KEY, {
            ...current,
            syncedAt: updatedAt,
            tasks: nextTasks,
            summary: {
              totalTasks: Math.max(current.summary.totalTasks, COLLECT_TASKS.length),
              successCount: Object.values(nextTasks).filter((task) => task.status === "success").length,
              errorCount: Object.values(nextTasks).filter((task) => task.status === "error").length,
            },
          });
        } catch {}
      }
      setTaskStates((prev) => ({
        ...prev,
        dashboard: {
          status: "error",
          message: detail,
        },
      }));
      message.error("同步失败: " + e.message);
    } finally {
      setSyncingDashboard(false);
    }
  }, [syncingDashboard]);

  const cancelCollection = useCallback(() => {
    if (!collecting) return;
    collectionRunRef.current += 1;
    // 关闭 worker 的浏览器来中断采集
    api?.close?.().catch(() => {});
    setCollecting(false);
    setProgress(0);
    // 把所有 running 状态改为 error
    setTaskStates((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key].status === "running") {
          next[key] = { status: "error", message: "已取消" };
        }
      }
      return next;
    });
    message.info("采集已取消");
  }, [collecting]);

  return (
    <CollectionContext.Provider value={{
      collecting, taskStates, progress, elapsed,
      successCount, errorCount,
      startCollectAll, cancelCollection, startSyncDashboard, syncingDashboard,
    }}>
      {children}
    </CollectionContext.Provider>
  );
}
