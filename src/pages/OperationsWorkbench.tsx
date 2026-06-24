import React, { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Alert, Button, Card, Empty, Image, InputNumber, Modal, Popover, Progress, Segmented, Select, Spin, Statistic, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend } from "recharts";
import { useNavigate } from "react-router-dom";
import { formatStoreNo, formatMallName } from "../utils/storeDisplay";
import { NoSearchSelect, QUALITY_SITE_LABEL, LEVEL_COLOR, TAG_COLOR, RISK_TYPE_LABEL, SEV_COLOR, SEV_TEXT, SEV_RANK, KIND_LABEL, ACTIVITY_TYPE_LABEL, diagnose, fmtNum, fmtMoney, calcAdvice, sellThroughDays, isSlowMoving } from "../utils/opsWorkbench";
import { HIDE_RISK, HIDE_ACTIVITY, HIDE_REVIEW, OFFICIAL_SOURCE, HIDE_DIAG, HIDE_RESTOCK, HIDE_STOCK } from "../utils/operationsFlags";
import { useSessionState } from "../hooks/useSessionState";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { selectStatusLabel } from "../utils/temuSelectStatus";
import PipelineTab from "../components/PipelineTab";
import OpsCommonFilters from "../components/ops/OpsCommonFilters";
import ReviewTab from "../components/ops/ReviewTab";
import SiteExceptionTab from "../components/ops/SiteExceptionTab";
import { useSkuSales, useRiskList, useStockOrders, useSalesTrend, useProductPanel, useFirstShipToday, useGoodsCreatedToday, useOpenapiQc, useHighPriceFlow, fetchHpfDetail, useActivityList, useQualityPanel, useLifecycle, useFlowAnalysis, fetchFlowTrend, reloadAllOpsReports } from "../hooks/useOpsReports";
import type { FlowTrendPoint } from "../hooks/useOpsReports";
import type { HpfDetail, FlowAnalysisRow } from "../types/opsWorkbench";
import { useStoreScope } from "../hooks/useStoreScope";
import { useOpsWorkbenchStore } from "../stores/opsWorkbenchStore";

interface SkuRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  skc_id: string | null; sku_ext_code: string | null; product_id: string | null;
  title: string | null; category: string | null;
  today: number; last7d: number; last30d: number;
  stock: number; occupy: number; advice_qty: number;
  sale_days: number | null; declared_price: number | null; stat_date: string | null;
}
interface RiskRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  risk_type: string | null; severity: string | null; title: string | null; status: string | null;
  product_id: string | null; skc_id: string | null; quantity: number; stat_date: string | null;
  __rk?: number;
}
interface ActivityRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  kind: string | null; title: string | null; status: string | null;
  activity_id: string | null; product_id: string | null; activity_type: number | null; sku_id: string | null;
  sku_ext_code: string | null; skc_id: string | null; color_spec: string | null;
  product_name: string | null; thumb: string | null;
  signup_price: number | null; suggested_price: number | null; price_diff: number | null;
  activity_stock: number; cost: number | null; end_at: string | null; stat_date: string | null;
  __rk?: number;
}
// 活动报名内嵌精简明细(后端 products[].activities):报名弹窗/今日待办/最小库存用。
// 父商品字段(mall/store/sku/skc/product_name 等)摊平时从 product 补,见 loadAct。
interface ActivitySkuDetail {
  sku_ext_code: string; spec_name: string | null; signup_price: number | null; suggested_price: number | null;
  activity_stock: number; cost: number | null; enroll_at: string | null; enroll_id: string | null;
}
interface ActivityDetail {
  activity_id: string | null; kind: string | null; title: string | null; status: string | null;
  activity_type: number | null; sku_id: string | null; sku_ext_code: string | null;
  signup_price: number | null; suggested_price: number | null; price_diff: number | null;
  activity_stock: number; cost: number | null; start_at: string | null; end_at: string | null; enroll_at: string | null; sites: string[];
  skus: ActivitySkuDetail[];
}
// 活动报名「概览」行:后端已按(店×货号)聚合好,act_count=可提交活动 pending_count=缺ID待采集。
// activities=该商品的精简活动明细(供弹窗/待办);kinds=涉及的活动类型(供前端筛选)。
interface ActProductRow {
  key: string; mall_id: string; store_code: string | null; mall_name: string | null;
  sku_ext_code: string; product_id: string | null; skc_id: string | null;
  product_name: string | null; thumb: string | null;
  sku_ext_codes?: string[]; act_count: number; pending_count: number;
  best_margin: number | null; best_profit: number | null;
  enrolled_count: number; kinds: string[]; activities: ActivityDetail[];
}
interface ShopHealthRow {
  mall_id: string; store_code: string | null; mall_name: string | null; owner: string | null;
  sale_volume: number; sale_7d: number; sale_30d: number;
  on_sale: number; wait_online: number; lack_skc: number; advice_prepare_skc: number;
  about_to_sell_out: number; already_sold_out: number; high_price_limit: number;
  after_sale_ratio_90d: number | null; stat_date: string | null; __rk?: number;
  visit_count?: number | null; pay_buyer_count?: number | null; visit_pay_rate?: number | null;
  dsr_score?: number | null; trade_amount_cents?: number | null; trade_order_count?: number | null;
  enrollable_activity_count?: number | null; enrolled_activity_count?: number | null;
  ongoing_activity_count?: number | null; total_activity_count?: number | null;
}
interface StockOrderRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  sku_ext_code: string | null; product_name: string | null; spec_name: string | null;
  source_type: string | null; demand_qty: number; delivered_qty: number; gap: number;
  shipping_qty: number; inbound_qty: number; latest_ship_at: string | null; warehouse: string | null; order_no: string | null;
  __rk?: number;
}
interface TrendRow { mall_id: string; store_code: string | null; mall_name: string | null; stat_date: string; sales: number; }
interface StoreMatrixRow {
  store_code: string; mall_id: string; mall_name: string | null; owner: string | null;
  sales: number; sale_7d: number; lack: number; soldout: number;
  high_risk: number; restock: number; stock_gap: number; activity: number;
  lc: Record<string, number>; // 各上新生命周期阶段(中文标签)的 SKC 数
  first_ship: number;         // 今日(北京)发出的首单数(按 WB 去重)
  goods_created: number;      // 今日(北京)创建的商品 SKC 数
}
interface SkuChild { skc_id: string | null; sku_ext_code: string | null; spec_name?: string | null; declared_price: number | null; today: number; last7d: number; last30d: number; sale_days: number | null; stock: number; occupy: number; unavail_stock?: number; shipping?: number; advice_qty: number; lack_qty?: number; }
interface FirstShipRow { mall_id: string; store_code: string | null; mall_name: string | null; sub_purchase_order_sn: string; delivery_order_sn: string | null; product_skc_id: string | null; ext_code: string | null; deliver_time: number | null; }
interface QcRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  qc_bill_id: string; product_sku_id: string | null; product_skc_id: string | null; spu_id: string | null;
  ext_code: string | null; sku_name: string | null; spec: string | null; cat_name: string | null;
  purchase_no: string | null; thumb_url: string | null;
  qc_result: number | null; qc_result_update_time: string | null; finish_time: string | null;
  expect_qty: number | null; defective_qty: number | null; qc_group_name: string | null; receipt_no: string | null;
  flaw_summary: string | null;
  flaws: Array<{ name: string | null; type: string | null; degree: string | null; degreeId: number | null; remark: string | null; images: string[] }>;
  flaw_image_count: number;
  flaw_thumb: string | null;
}
// 商品品质看板(Temu 后台「商品品质看板」抓包):一行 = 一个商品
interface QualityRow {
  mall_id: string; site: string; store_code: string | null; mall_name: string | null; owner: string | null;
  product_id: string | null; goods_id: string | null; product_name: string | null;
  image_url: string | null; category_name: string | null;
  afs_score: number | null;        // 品质分(goodsAfsScore,0-100,越低越差)
  afs_order_rate: number | null;   // 品质售后订单率
  afs_order_cnt: number | null;    // 品质售后订单数
  afs_problems: string | null;     // 售后问题分布摘要
  rev_cnt: number | null;          // 评价数
  avg_rev_score: number | null;    // 平均评分(5分制)
  rev_problems: string | null;     // 差评问题分布摘要
  captured_at: number | null;      // 抓包时间(epoch ms)
}
// 商品品质看板 - 店铺级 90 天指标
interface QualityShopRow {
  mall_id: string; site: string; store_code: string | null; mall_name: string | null; owner: string | null;
  afs_rate_90d: number | null; avg_score_90d: number | null; expect_loss: number | null; captured_at: number | null;
}

interface ProductPanelRow {
  mall_id: string; product_id: string; store_code: string | null; mall_name: string | null; title: string | null; thumb: string | null;
  skc_codes: string | null; sku_codes: string | null; declared_price: number | null; score: number | null; comments: number | null;
  stock: number | null; occupy: number | null; unavail: number | null; advice: number | null; lack: number | null; lack_qty: number | null; shipping: number | null; total_stock: number | null;
  expose: number | null; click: number | null; pay: number | null; conv: number | null; grow: string | null; onsales_duration: number | null; hot_tag?: boolean; has_hot_sku?: boolean;
  limited: boolean; act_cnt: number; min_price: number | null; compliance: string | null; skus_detail?: SkuChild[]; __rk?: number;
}

// 高价限流清单行(SPU 级):被 Temu「高价流量受限」的商品;数据=抓包,官方 API 无
interface HpfRow {
  mall_id: string; store_code: string | null; mall_name: string | null; owner: string | null;
  product_id: string; skc_id: string | null; title: string | null; thumb: string | null;
  sku_codes: string | null; decline_rate: number | null; last_seen_date: string | null;
  declared_price: number | null; current_price: number | null; target_price: number | null; stock: number | null; today_sales: number | null; last7d_sales: number | null;
  __rk?: number;
}

interface Diag { label: string; action: string; level: number }
interface DiagnosedRow extends SkuRow { _level: number; _issues: Diag[] }


// ========== 纯静态 column 定义(不引用组件 state/回调,避免每次渲染重建) ==========
const storeColStatic = { title: "店号", dataIndex: "store_code", width: 88, fixed: "left" as const, render: (v: string | null) => <Typography.Text strong>{formatStoreNo(v)}</Typography.Text>, sorter: (a: any, b: any) => (a.store_code || "").localeCompare(b.store_code || "") };

const SRC_LABEL: Record<string, string> = { stock_order: "备货单", shipping_list: "发货单", shipping_desk: "发货台" };
const stockColumnsStatic: ColumnsType<StockOrderRow> = [
  { title: "店号", dataIndex: "store_code", width: 88, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
  { title: "货号", dataIndex: "sku_ext_code", width: 120, render: (v) => v || "—" },
  { title: "商品", dataIndex: "product_name", width: 200, ellipsis: true, render: (v, r) => <span>{v || "—"}{r.spec_name ? <span style={{ color: "#999" }}> / {r.spec_name}</span> : null}</span> },
  { title: "类型", dataIndex: "source_type", width: 80, render: (v: string | null) => (v ? SRC_LABEL[v] || v : "—") },
  { title: "需求量", dataIndex: "demand_qty", width: 80, align: "right", sorter: (a, b) => a.demand_qty - b.demand_qty, render: fmtNum },
  { title: "已发", dataIndex: "delivered_qty", width: 75, align: "right", render: fmtNum },
  { title: "缺口", dataIndex: "gap", width: 80, align: "right", sorter: (a, b) => a.gap - b.gap, defaultSortOrder: "descend", render: (v: number) => (v > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtNum(v)}</span> : fmtNum(v)) },
  { title: "已入库", dataIndex: "inbound_qty", width: 80, align: "right", render: fmtNum },
  { title: "最晚发货", dataIndex: "latest_ship_at", width: 130, render: (v: string | null) => { if (!v) return "—"; const n = Number(v); return Number.isFinite(n) && n > 1e11 ? new Date(n).toLocaleDateString("zh-CN") : String(v); } },
  { title: "收货仓", dataIndex: "warehouse", width: 140, ellipsis: true, render: (v) => v || "—" },
];

const riskColumnsStatic: ColumnsType<RiskRow> = [
  storeColStatic,
  { title: "严重度", dataIndex: "severity", width: 80, render: (v: string | null) => <Tag color={SEV_COLOR[v || ""] || "default"}>{SEV_TEXT[v || ""] || v || "—"}</Tag>, sorter: (a, b) => (SEV_RANK[a.severity || ""] || 0) - (SEV_RANK[b.severity || ""] || 0), defaultSortOrder: "descend" },
  { title: "风险类型", dataIndex: "risk_type", width: 120, render: (v: string | null) => RISK_TYPE_LABEL[v || ""] || v || "—" },
  { title: "标题 / 商品", dataIndex: "title", width: 360, render: (v: string | null) => <Tooltip title={v || ""}><div style={{ maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v || "—"}</div></Tooltip> },
  { title: "数量", dataIndex: "quantity", width: 80, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.quantity - b.quantity },
  { title: "SKC", dataIndex: "skc_id", width: 130, render: (v: string | null) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v || "—"}</Typography.Text> },
];

const redNum = (color: string) => (v: number) => (v > 0 ? <span style={{ color, fontWeight: 600 }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>);
const LC_SHORT: Record<string, string> = { "已发布到站点": "在售", "未发布": "未发布", "待寄样": "待寄样", "价格申报中": "申报中", "待创建首单": "待首单", "已创建首单": "已首单", "已下架/终止": "已下架" };
// 上新生命周期阶段展示顺序(中文,与 selectStatusLabel 输出一致)
const LIFECYCLE_STAGE_ORDER = ["未发布", "待寄样", "价格申报中", "待创建首单", "已创建首单", "已发布到站点", "已下架/终止"];
const storeMatrixColumnsStatic: ColumnsType<StoreMatrixRow> = [
  { title: "店号", dataIndex: "store_code", width: 88, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
  { title: "店铺", dataIndex: "mall_name", width: 130, ellipsis: true, render: (v: string | null) => formatMallName(v) },
  { title: "负责人", dataIndex: "owner", width: 70, render: (v) => v || "—" },
  { title: "今日销量", dataIndex: "sales", width: 95, align: "right", sorter: (a, b) => a.sales - b.sales, defaultSortOrder: "descend", render: fmtNum },
  { title: "7天销量", dataIndex: "sale_7d", width: 95, align: "right", sorter: (a, b) => a.sale_7d - b.sale_7d, render: fmtNum },
  { title: "缺货", dataIndex: "lack", width: 70, align: "right", sorter: (a, b) => a.lack - b.lack, render: redNum("#d46b08") },
  { title: "售罄", dataIndex: "soldout", width: 70, align: "right", sorter: (a, b) => a.soldout - b.soldout, render: redNum("#cf1322") },
  { title: "高风险", dataIndex: "high_risk", width: 75, align: "right", sorter: (a, b) => a.high_risk - b.high_risk, render: redNum("#cf1322") },
  { title: "待补货", dataIndex: "restock", width: 75, align: "right", sorter: (a, b) => a.restock - b.restock, render: redNum("#d46b08") },
  { title: "备货缺口", dataIndex: "stock_gap", width: 95, align: "right", sorter: (a, b) => a.stock_gap - b.stock_gap, render: fmtNum },
  { title: "可报活动", dataIndex: "activity", width: 95, align: "right", sorter: (a, b) => a.activity - b.activity, render: (v: number) => (v > 0 ? <span style={{ color: "#3f8600" }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
  { title: "今日首单", dataIndex: "first_ship", width: 90, align: "right", sorter: (a, b) => a.first_ship - b.first_ship, render: (v: number) => (v > 0 ? <span style={{ color: "#1a73e8", fontWeight: 600 }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
  { title: "今日创建", dataIndex: "goods_created", width: 90, align: "right", sorter: (a, b) => a.goods_created - b.goods_created, render: (v: number) => (v > 0 ? <span style={{ color: "#13c2c2", fontWeight: 600 }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
  ...LIFECYCLE_STAGE_ORDER.map((label): ColumnsType<StoreMatrixRow>[number] => ({
    title: LC_SHORT[label] || label, key: "lc_" + label, width: 88, align: "right",
    sorter: (a, b) => (a.lc?.[label] || 0) - (b.lc?.[label] || 0),
    render: (_, r) => { const n = r.lc?.[label] || 0; const color = label === "已发布到站点" ? "#3f8600" : label === "已下架/终止" ? "#8c8c8c" : "#d46b08"; return n > 0 ? <span style={{ color }}>{fmtNum(n)}</span> : <span style={{ color: "#bbb" }}>0</span>; },
  })),
];

const qualityColumnsStatic: ColumnsType<QualityRow> = [
  { title: "店号", dataIndex: "store_code", width: 78, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
  { title: "站点", dataIndex: "site", width: 64, fixed: "left", align: "center", render: (v: string) => <Tag color={v === "us" ? "blue" : v === "eu" ? "purple" : "default"}>{QUALITY_SITE_LABEL[v] || v || "—"}</Tag> },
  { title: "商品", key: "prod", width: 300, render: (_, r) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {r.image_url ? <div style={{ flexShrink: 0, width: 64, height: 64 }}><Image src={r.image_url} width={64} height={64} style={{ objectFit: "cover", borderRadius: 4 }} /></div> : <div style={{ width: 64, height: 64, background: "#f0f0f0", borderRadius: 4, flexShrink: 0 }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, lineHeight: 1.4, maxHeight: 50, overflow: "hidden" }}>{r.product_name || "—"}</div>
        <div style={{ fontSize: 11, color: "#8c8c8c" }}>{r.category_name || ""}{r.product_id ? ` · ${r.product_id}` : ""}</div>
      </div>
    </div>
  ) },
  { title: "品质分", dataIndex: "afs_score", width: 90, align: "center", defaultSortOrder: "ascend", sorter: (a, b) => (a.afs_score ?? 999) - (b.afs_score ?? 999), render: (v: number | null) => {
    if (v == null) return <span style={{ color: "#bbb" }}>—</span>;
    const color = v < 60 ? "#cf1322" : v < 75 ? "#d46b08" : "#3f8600";
    return <span style={{ color, fontWeight: 600, fontSize: 16 }}>{v.toFixed(1)}</span>;
  } },
  { title: "售后率", dataIndex: "afs_order_rate", width: 116, align: "right", sorter: (a, b) => (a.afs_order_rate ?? 0) - (b.afs_order_rate ?? 0), render: (v: number | null, r) => {
    if (v == null) return <span style={{ color: "#bbb" }}>—</span>;
    const pct = v * 100;
    const color = pct >= 3 ? "#cf1322" : pct >= 1.5 ? "#d46b08" : "#595959";
    return <span style={{ color }}>{pct.toFixed(2)}%{r.afs_order_cnt != null ? <span style={{ color: "#8c8c8c", fontSize: 11 }}> / {r.afs_order_cnt}单</span> : null}</span>;
  } },
  { title: "售后问题", dataIndex: "afs_problems", width: 240, render: (v: string | null) => v ? <span style={{ color: "#cf1322", fontSize: 12 }}>{v}</span> : <span style={{ color: "#bbb" }}>—</span> },
  { title: "评分", dataIndex: "avg_rev_score", width: 116, align: "center", sorter: (a, b) => (a.avg_rev_score ?? 0) - (b.avg_rev_score ?? 0), render: (v: number | null, r) => {
    if (v == null) return <span style={{ color: "#bbb" }}>—</span>;
    const color = v <= 3 ? "#cf1322" : v >= 4 ? "#3f8600" : "#d4b106";
    return <span style={{ color, whiteSpace: "nowrap" }}>★{v.toFixed(2)}{r.rev_cnt != null ? <span style={{ color: "#8c8c8c", fontSize: 11 }}> / {r.rev_cnt}评</span> : null}</span>;
  } },
  { title: "差评问题", dataIndex: "rev_problems", width: 200, render: (v: string | null) => v ? <span style={{ color: "#d46b08", fontSize: 12 }}>{v}</span> : <span style={{ color: "#bbb" }}>—</span> },
  { title: "抓包时间", dataIndex: "captured_at", width: 150, sorter: (a, b) => (a.captured_at ?? 0) - (b.captured_at ?? 0), render: (v: number | null) => v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "—" },
];

const restockColumnsStatic: ColumnsType<SkuRow> = [
  storeColStatic,
  { title: "商品 · SKU / SKC / SPU", key: "sku", width: 300,
    render: (_: any, r: SkuRow) => (
      <div>
        <Typography.Text copyable={{ text: r.sku_ext_code || "" }} style={{ fontSize: 12, fontWeight: 600 }}>{r.sku_ext_code || "(无货号)"}</Typography.Text>
        <Tooltip title={r.title || ""}><div style={{ color: "#888", fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</div></Tooltip>
        <div style={{ fontSize: 11, color: "#aaa" }}>
          {r.skc_id ? <span>SKC&nbsp;{r.skc_id}</span> : null}
          {r.product_id ? <span style={{ marginLeft: 8 }}>SPU&nbsp;{r.product_id}</span> : null}
        </div>
      </div>
    ),
  },
  { title: "库存", dataIndex: "stock", width: 90, align: "right", render: (v: number, r) => <span style={{ color: v <= 0 ? "#cf1322" : undefined }}>{fmtNum(v)}{r.occupy > 0 ? <span style={{ color: "#aaa", fontSize: 11 }}> /占{fmtNum(r.occupy)}</span> : null}</span>, sorter: (a, b) => a.stock - b.stock },
  { title: "可售天数", dataIndex: "sale_days", width: 90, align: "right", render: (v: number | null) => (v == null ? "—" : <span style={{ color: v < 7 ? "#cf1322" : v < 14 ? "#d46b08" : undefined }}>{v}天</span>), sorter: (a, b) => (a.sale_days ?? Infinity) - (b.sale_days ?? Infinity) },
  { title: "建议备货", dataIndex: "advice_qty", width: 100, align: "right", render: (v: number) => (v > 0 ? <Tag color="blue">{fmtNum(v)}</Tag> : "—"), sorter: (a, b) => a.advice_qty - b.advice_qty, defaultSortOrder: "descend" },
  { title: "近7天", dataIndex: "last7d", width: 75, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last7d - b.last7d },
  { title: "近30天", dataIndex: "last30d", width: 80, align: "right", render: (v) => fmtNum(v) },
  { title: "申报价", dataIndex: "declared_price", width: 80, align: "right", render: (v: number | null) => (v == null ? "—" : "¥" + v.toFixed(2)) },
];

const diagColumnsStatic: ColumnsType<DiagnosedRow> = [
  storeColStatic,
  { title: "商品 · SKU / SKC / SPU", key: "sku", width: 300,
    render: (_: any, r: SkuRow) => (
      <div>
        <Typography.Text copyable={{ text: r.sku_ext_code || "" }} style={{ fontSize: 12, fontWeight: 600 }}>{r.sku_ext_code || "(无货号)"}</Typography.Text>
        <Tooltip title={r.title || ""}><div style={{ color: "#888", fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</div></Tooltip>
        <div style={{ fontSize: 11, color: "#aaa" }}>
          {r.skc_id ? <span>SKC&nbsp;{r.skc_id}</span> : null}
          {r.product_id ? <span style={{ marginLeft: 8 }}>SPU&nbsp;{r.product_id}</span> : null}
        </div>
      </div>
    ),
  },
  { title: "诊断", key: "diag", width: 150, render: (_, r) => r._issues.length ? <span>{r._issues.map((i) => <Tag key={i.label} color={TAG_COLOR[i.level]} style={{ marginBottom: 2 }}>{i.label}</Tag>)}</span> : <Tag color="green">健康</Tag>, sorter: (a, b) => a._level - b._level, defaultSortOrder: "descend" },
  { title: "建议动作", key: "action", width: 290, render: (_, r) => r._issues.length ? <div style={{ fontSize: 12 }}>{r._issues.map((i) => <div key={i.label} style={{ color: LEVEL_COLOR[i.level] }}>· {i.action}</div>)}</div> : <span style={{ color: "#aaa" }}>正常在售</span> },
  { title: "近7天", dataIndex: "last7d", width: 75, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last7d - b.last7d },
  { title: "近30天", dataIndex: "last30d", width: 80, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last30d - b.last30d },
  { title: "库存", dataIndex: "stock", width: 80, align: "right", render: (v: number) => <span style={{ color: v <= 0 ? "#cf1322" : undefined }}>{fmtNum(v)}</span>, sorter: (a, b) => a.stock - b.stock },
  { title: "可售天数", dataIndex: "sale_days", width: 85, align: "right", render: (v: number | null) => (v == null ? "—" : <span style={{ color: v < 7 ? "#d46b08" : undefined }}>{v}天</span>) },
];

// 估算文本在规格列(宽~150,可用~138px)的像素宽:中文/全角按12px,空格4px,其余(数字/字母/标点)7px
const estTextW = (t: string | null | undefined) => { let w = 0; for (const ch of String(t ?? "")) w += /[一-龥＀-￯]/.test(ch) ? 13 : ch === " " ? 4 : 7.5; return w; };
// SKU 堆叠单元格(纯渲染函数,不依赖组件 state)
const stackCell = (skus: SkuChild[], get: (s: SkuChild) => React.ReactNode, total?: React.ReactNode, showLabel = false) => {
  if (!skus.length) return <span style={{ color: "#bbb" }}>—</span>;
  const lineH = 19;
  if (skus.length === 1) return <div style={{ height: "100%", minHeight: lineH + 4, display: "flex", flexDirection: "column", justifyContent: "center", fontSize: 13 }}>{get(skus[0])}</div>;
  const rowMin = (s: SkuChild) => Math.max(1, Math.ceil(estTextW(s.spec_name) / 128)) * lineH + 4;
  const rowBase: React.CSSProperties = { boxSizing: "border-box", padding: "2px 0", overflow: "hidden", fontSize: 13, lineHeight: `${lineH}px`, textAlign: "inherit", display: "flex", flexDirection: "column", justifyContent: "center", flex: "1 1 0" };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: (skus.length + 1) * (lineH + 4) }}>
      {skus.map((s, i) => <div key={i} style={{ ...rowBase, minHeight: rowMin(s), borderBottom: "1px solid #f5f5f5" }}>{get(s)}</div>)}
      {showLabel ? (
        <div style={{ ...rowBase, minHeight: lineH + 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", whiteSpace: "nowrap", fontWeight: total != null ? 600 : 400, color: total != null ? "#1a73e8" : undefined }}>{total != null ? <><span>合计</span><span>{total}</span></> : null}</div>
      ) : (
        <div style={{ ...rowBase, minHeight: lineH + 4, alignItems: "flex-end", fontWeight: total != null ? 600 : 400, color: total != null ? "#1a73e8" : undefined }}>{total}</div>
      )}
    </div>
  );
};
const skusOfFn = (r: ProductPanelRow): SkuChild[] => r.skus_detail || [];

export default function OperationsWorkbench() {
  const owViewKey = (suffix: string) => `temu.ops-workbench.${suffix}`;
  const [activeTab, setActiveTab] = useSessionState(owViewKey("tab"), "overview");
  // 「商品全景」Tab(PipelineTab)自管数据,顶部统一刷新通过递增此信号触发它重新加载
  const [pipelineReloadSignal, setPipelineReloadSignal] = useState(0);
  // 「我的店」视角:按负责人(owner)过滤全局,记住上次选择
  const ownerFilter = useOpsWorkbenchStore((s) => s.ownerFilter);
  const setOwner = useOpsWorkbenchStore((s) => s.setOwnerFilter);
  // 合并 Tab 内的子段切换
  const [prodSeg, setProdSeg] = useSessionState<string>(owViewKey("prodSeg"), "panel");

  const goProduct = useCallback((seg: string) => { setProdSeg(seg); setActiveTab("product"); }, []);
  // 数据层:SWR hooks(enabled 对齐原 activeTab 条件;首次拉满即停;刷新走 reloadAllOpsReports)
  const { rows: skuRows, loading: skuLoading, reload: loadSku }: { rows: SkuRow[]; loading: boolean; reload: () => void } = useSkuSales();
  const { rows: riskRows, loading: riskLoading }: { rows: RiskRow[]; loading: boolean } = useRiskList(activeTab === "risk" || activeTab === "todo" || activeTab === "pipeline");
  const { products: actProducts, rows: actRows, loading: actLoading }: { products: ActProductRow[]; rows: ActivityRow[]; loading: boolean } = useActivityList(activeTab === "activity" || activeTab === "todo");
  const { rows: stockRows, loading: stockLoading, loaded: stockLoaded }: { rows: StockOrderRow[]; loading: boolean; loaded: boolean } = useStockOrders(activeTab === "stock");
  const { rows: trendRows, loading: trendLoading }: { rows: TrendRow[]; loading: boolean } = useSalesTrend(!OFFICIAL_SOURCE && activeTab === "overview");
  const { rows: panelRows, loading: panelLoading }: { rows: ProductPanelRow[]; loading: boolean } = useProductPanel(activeTab === "product" || activeTab === "pipeline");
  const { rows: firstShipRows }: { rows: FirstShipRow[] } = useFirstShipToday(activeTab === "overview");
  const { rows: goodsCreatedRows }: { rows: Array<{ mall_id: string; store_code: string | null }> } = useGoodsCreatedToday(activeTab === "overview");
  const { rows: qcRows, loading: qcLoading }: { rows: QcRow[]; loading: boolean } = useOpenapiQc(activeTab === "qc" || activeTab === "pipeline");
  const { rows: qualityRows, shops: qualityShops, loading: qualityLoading }: { rows: QualityRow[]; shops: QualityShopRow[]; loading: boolean } = useQualityPanel(activeTab === "quality" || activeTab === "pipeline");
  const { rows: hpfRows, loading: hpfLoading }: { rows: HpfRow[]; loading: boolean } = useHighPriceFlow(activeTab === "hpf" || activeTab === "pipeline");
  const { rows: lifecycleRows, loading: lifecycleLoading }: { rows: Array<{ mall_id: string; skc_id: string; status: string }>; loading: boolean } = useLifecycle(activeTab === "overview" || activeTab === "product");
  const [flowDateFilter, setFlowDateFilter] = useSessionState(owViewKey("flowDate"), "");
  const { rows: flowRows, availableDates: flowDates, loading: flowLoading } = useFlowAnalysis(activeTab === "flux", flowDateFilter);
  useEffect(() => { if (!flowDateFilter && flowDates.length > 0) setFlowDateFilter(flowDates[0]); }, [flowDates, flowDateFilter, setFlowDateFilter]);
  // 字典共享:店铺健康全局只拉一次,派生 owner 映射/过滤
  const { shopRows, shopLoading, ownerOptions, inScope }: { shopRows: ShopHealthRow[]; shopLoading: boolean; ownerOptions: string[]; inScope: (code: string | null | undefined) => boolean } = useStoreScope();
  // 保留:销量趋势弹窗 / 疵点照片预览(非 report,组件局部 UI 态)
  const [trendOf, setTrendOf] = useState<{ productId: string; title: string } | null>(null);
  const [trendModalRows, setTrendModalRows] = useState<Array<{ date: string; qty: number; revenue: number }>>([]);
  const [trendModalLoading, setTrendModalLoading] = useState(false);
  const [flowTrendOf, setFlowTrendOf] = useState<{ mallId: string; productId: string; goodsId: string; site: string; title: string } | null>(null);
  const [flowTrendRows, setFlowTrendRows] = useState<Record<string, any>[]>([]);
  const [flowTrendLoading, setFlowTrendLoading] = useState(false);
  const [flawPreviewVisible, setFlawPreviewVisible] = useState(false);
  const [flawPreviewImages, setFlawPreviewImages] = useState<string[]>([]);
  const [hpfDetailOpen, setHpfDetailOpen] = useState(false);
  const [hpfDetail, setHpfDetail] = useState<HpfDetail | null>(null);
  const [hpfDetailLoading, setHpfDetailLoading] = useState(false);
  const [hpfSiteDetailOpen, setHpfSiteDetailOpen] = useState(false);
  const openHpfDetail = useCallback(async (mallId: string, productId: string) => {
    setHpfDetailOpen(true);
    setHpfDetailLoading(true);
    setHpfDetail(null);
    try {
      const d = await fetchHpfDetail(mallId, productId);
      setHpfDetail(d);
    } catch { /* ignore */ }
    setHpfDetailLoading(false);
  }, []);
  const [error] = useState<string | null>(null);

  const [storeFilter, setStoreFilter] = useSessionState(owViewKey("storeFilter"), "all");
  const [diagFilter, setDiagFilter] = useSessionState(owViewKey("diagFilter"), "all");
  const [searchInput, setSearchInput] = useSessionState(owViewKey("search"), "");
  // 搜索框防抖：输入框绑 searchInput 跟手，下游多个视图过滤用防抖后的 search（变量名不变，下游无需改）。
  const search = useDebouncedValue(searchInput, 250);
  const [slowFilter, setSlowFilter] = useSessionState(owViewKey("slowFilter"), "all"); // 商品运营全景:全部 / 仅看滞销
  const [onsaleDaysFilter, setOnsaleDaysFilter] = useSessionState(owViewKey("onsaleDays"), "all"); // 加入站点天数筛选
  const [sevFilter, setSevFilter] = useSessionState(owViewKey("sevFilter"), "all");
  const [kindFilter, setKindFilter] = useSessionState(owViewKey("kindFilter"), "all");
  const [hpfStatusFilter, setHpfStatusFilter] = useSessionState(owViewKey("hpfStatus"), "all");
  const [, startJumpTransition] = useTransition();
  const jumpWorkbench = useCallback((tab: string, query: string, before?: () => void) => {
    before?.();
    setActiveTab(tab);
    if (query) startJumpTransition(() => setSearchInput(query));
  }, [setActiveTab, setSearchInput, startJumpTransition]);
  const goPipelineRiskTag = useCallback((tag: string, item: { code?: string; name?: string; productId?: string | null }) => {
    const codeQuery = String(item.code || "").trim();
    const productQuery = String(item.productId || "").trim();
    const nameQuery = String(item.name || "").trim();
    if (tag === "qc_fail") {
      jumpWorkbench("qc", codeQuery || nameQuery || productQuery);
      return;
    }
    if (tag === "compliance") {
      jumpWorkbench("product", productQuery || nameQuery || codeQuery, () => setProdSeg("panel"));
      return;
    }
    if (tag === "limited") {
      jumpWorkbench("hpf", productQuery || nameQuery || codeQuery);
      return;
    }
    if (tag === "stock_out" || tag === "urgent_restock") {
      jumpWorkbench("product", codeQuery || nameQuery || productQuery, () => setProdSeg("restock"));
      return;
    }
    if (tag === "quality_score" || tag === "low_score" || tag === "many_bad_reviews" || tag === "high_return_rate" || tag === "quality" || tag === "quality_risk") {
      jumpWorkbench("quality", productQuery || nameQuery || codeQuery);
      return;
    }

    jumpWorkbench("risk", nameQuery || codeQuery || productQuery);
  }, [jumpWorkbench, setProdSeg]);
  const [actStatusFilter, setActStatusFilter] = useState<string>("进行中");
  const [enrollProdKey, setEnrollProdKey] = useState<string | null>(null);
  const [selActRows, setSelActRows] = useState<ActivityRow[]>([]);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [batchPrice, setBatchPrice] = useState<number | null>(null);
  const [batchStock, setBatchStock] = useState<number | null>(null);
  const navigate = useNavigate();

  // 点击疵点图:实时去 Temu 拉(私有图签名会失效,不能用存的 URL),后端带 referer 拉成 base64 返回
  const openFlawImages = useCallback(async (mallId: string, qcBillId: string) => {
    if (!window.electronAPI?.erp?.reports?.qcFlawImages) return;
    const hide = message.loading("加载疵点照片…", 0);
    try {
      const resp = await window.electronAPI.erp.reports.qcFlawImages({ mallId, qcBillId });
      hide();
      const imgs = (resp.ok && resp.data && resp.data.images) || [];
      if (imgs.length) { setFlawPreviewImages(imgs); setFlawPreviewVisible(true); } else message.info("未取到疵点照片");
    } catch { hide(); message.error("加载疵点照片失败"); }
  }, []);

  // 商品销量趋势弹窗:打开时按 product_id 拉逐日数据(走 cloud 抓包快照)
  useEffect(() => {
    if (!trendOf) return;
    let alive = true;
    setTrendModalLoading(true); setTrendModalRows([]);
    (async () => {
      try {
        const resp = await window.electronAPI.erp.reports.productTrend({ productId: trendOf.productId });
        if (alive && resp?.ok && resp.data) setTrendModalRows(resp.data.rows || []);
      } catch { /* */ } finally { if (alive) setTrendModalLoading(false); }
    })();
    return () => { alive = false; };
  }, [trendOf]);
  const diagnosed: DiagnosedRow[] = useMemo(() => skuRows.map((r) => {
    const issues = diagnose(r);
    return { ...r, _issues: issues, _level: issues.length ? Math.max(...issues.map((i) => i.level)) : 0 };
  }), [skuRows]);
  const isPipelineStoreInScope = useCallback((storeCode?: string | null, mallId?: string | null) => {
    return inScope(storeCode || mallId);
  }, [inScope]);

  const storeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of skuRows) if (r.store_code && inScope(r.store_code || r.mall_id)) s.add(r.store_code);
    return Array.from(s).sort();
  }, [skuRows, inScope]);

  const overview = useMemo(() => {
    let urgent = 0, warn = 0, note = 0, healthy = 0;
    const byLabel: Record<string, number> = {};
    for (const r of diagnosed) {
      if (!inScope(r.store_code || r.mall_id)) continue;
      if (r._level === 3) urgent++; else if (r._level === 2) warn++; else if (r._level === 1) note++; else healthy++;
      for (const i of r._issues) byLabel[i.label] = (byLabel[i.label] || 0) + 1;
    }
    return { urgent, warn, note, healthy, byLabel };
  }, [diagnosed, inScope]);

  const diagView = useMemo(() => {
    if (activeTab !== "product") return [] as DiagnosedRow[];
    let v = diagnosed.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    if (diagFilter === "urgent") v = v.filter((r) => r._level === 3);
    else if (diagFilter === "warn") v = v.filter((r) => r._level === 2);
    else if (diagFilter === "note") v = v.filter((r) => r._level === 1);
    else if (diagFilter === "issues") v = v.filter((r) => r._level > 0);
    else if (diagFilter !== "all") v = v.filter((r) => r._issues.some((i) => i.label === diagFilter));
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.title || "").toLowerCase().includes(q));
    return [...v].sort((a, b) => b._level - a._level || b.last7d - a.last7d);
  }, [activeTab, diagnosed, storeFilter, diagFilter, search, inScope]);

  // 库存补货：需补货 SKU（售罄/即将断货/有建议备货），紧急度排序
  const restockView = useMemo(() => {
    const need = (r: SkuRow) => (r.stock || 0) <= 0 || (r.sale_days != null && r.sale_days < 14) || (r.advice_qty || 0) > 0;
    const urg = (r: SkuRow) => {
      if ((r.stock || 0) <= 0 && ((r.last30d || 0) > 0 || (r.last7d || 0) > 0)) return 3;
      if (r.sale_days != null && r.sale_days < 7) return 2;
      if ((r.advice_qty || 0) > 0 || (r.sale_days != null && r.sale_days < 14)) return 1;
      return 0;
    };
    let v = skuRows.filter((r) => need(r) && inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.title || "").toLowerCase().includes(q));
    return [...v].sort((a, b) => urg(b) - urg(a) || (a.sale_days ?? Infinity) - (b.sale_days ?? Infinity) || b.advice_qty - a.advice_qty);
  }, [skuRows, storeFilter, search, inScope]);

  const riskStoreReady = riskRows;
  const riskOverview = useMemo(() => {
    let high = 0, medium = 0, low = 0;
    for (const r of riskRows) { if (!inScope(r.store_code || r.mall_id)) continue; if (r.severity === "high") high++; else if (r.severity === "medium") medium++; else low++; }
    return { high, medium, low };
  }, [riskRows, inScope]);
  const riskView = useMemo(() => {
    let v = riskStoreReady.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    if (sevFilter !== "all") v = v.filter((r) => r.severity === sevFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.risk_type || "").toLowerCase().includes(q) || (r.skc_id || "").includes(q));
    return [...v].sort((a, b) => (SEV_RANK[b.severity || ""] || 0) - (SEV_RANK[a.severity || ""] || 0)).map((r, i) => ({ ...r, __rk: i }));
  }, [riskStoreReady, storeFilter, sevFilter, search, inScope]);

  // 活动报名「概览」:后端已聚合好每商品一行(店×货号),前端只做用户筛选(范围/店铺/活动类型/搜索/状态),沿用后端排序
  const actProductView = useMemo<(ActProductRow & { _actInProgress: number; _actPending: number; _actTotal: number })[]>(() => {
    let v = actProducts.filter((p) => inScope(p.store_code || p.mall_id));
    if (storeFilter !== "all") v = v.filter((p) => p.store_code === storeFilter);
    if (kindFilter !== "all") v = v.filter((p) => p.kinds.includes(kindFilter));
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((p) => (p.product_name || "").toLowerCase().includes(q) || (p.sku_ext_code || "").toLowerCase().includes(q));
    const enriched = v.map(p => {
      const acts = p.activities.filter(a => a.status !== "已结束");
      const inProg = acts.filter(a => a.status === "进行中").length;
      const pending = acts.filter(a => a.status === "未开始").length;
      return { ...p, _actInProgress: inProg, _actPending: pending, _actTotal: acts.length };
    });
    const withActs = enriched.filter(p => p._actTotal > 0);
    if (actStatusFilter === "进行中") return withActs.filter(p => p._actInProgress > 0);
    if (actStatusFilter === "未开始") return withActs.filter(p => p._actPending > 0);
    return withActs;
  }, [actProducts, storeFilter, kindFilter, search, inScope, actStatusFilter]);

  const actStatusCounts = useMemo(() => {
    let v = actProducts.filter((p) => inScope(p.store_code || p.mall_id));
    if (storeFilter !== "all") v = v.filter((p) => p.store_code === storeFilter);
    if (kindFilter !== "all") v = v.filter((p) => p.kinds.includes(kindFilter));
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((p) => (p.product_name || "").toLowerCase().includes(q) || (p.sku_ext_code || "").toLowerCase().includes(q));
    const withActs = v.filter(p => p.activities.some(a => a.status !== "已结束"));
    const c: Record<string, number> = { "全部": withActs.length };
    for (const p of withActs) {
      const acts = p.activities.filter(a => a.status !== "已结束");
      if (acts.some(a => a.status === "进行中")) c["进行中"] = (c["进行中"] || 0) + 1;
      if (acts.some(a => a.status === "未开始")) c["未开始"] = (c["未开始"] || 0) + 1;
    }
    return c;
  }, [actProducts, storeFilter, kindFilter, search, inScope]);
  const enrollProduct = useMemo(() => enrollProdKey ? actProducts.find(p => p.key === enrollProdKey) ?? null : null, [enrollProdKey, actProducts]);
  type ModalActRow = ActivityRow & { enroll_at: string | null; start_at: string | null; sites: string[]; skus: ActivitySkuDetail[] };
  const modalActRows = useMemo<ModalActRow[]>(() => {
    if (!enrollProduct) return [];
    return enrollProduct.activities.map((a, i) => ({
      mall_id: enrollProduct.mall_id, store_code: enrollProduct.store_code, mall_name: enrollProduct.mall_name,
      kind: a.kind, title: a.title, status: a.status, activity_id: a.activity_id,
      product_id: enrollProduct.product_id, activity_type: a.activity_type, sku_id: a.sku_id,
      sku_ext_code: enrollProduct.sku_ext_code, skc_id: enrollProduct.skc_id, color_spec: (enrollProduct as any).color_spec ?? null,
      product_name: enrollProduct.product_name, thumb: enrollProduct.thumb,
      signup_price: a.signup_price, suggested_price: a.suggested_price, price_diff: a.price_diff,
      activity_stock: a.activity_stock, remaining_stock: (a as any).remaining_stock, cost: a.cost, end_at: a.end_at, stat_date: null, __rk: i,
      enroll_at: a.enroll_at, start_at: a.start_at, sites: a.sites || [], skus: a.skus || [],
    }));
  }, [enrollProduct]);
  const [modalStatusFilter, setModalStatusFilter] = useState<string>("全部");
  const [enrollDraft, setEnrollDraft] = useState<Record<string, { price?: number; stock?: number }>>(() => {
    try { return JSON.parse(localStorage.getItem("ow_enroll_draft") || "{}"); } catch { return {}; }
  });
  const enrollKey = useCallback((r: ActivityRow) => `${r.mall_id}|${r.activity_id || r.kind || ""}|${r.sku_ext_code || r.skc_id || ""}`, []);
  const setDraft = useCallback((key: string, patch: { price?: number | null; stock?: number | null }) => {
    setEnrollDraft(prev => {
      const cur = { ...(prev[key] || {}) };
      if ("price" in patch) { if (patch.price == null) delete cur.price; else cur.price = patch.price; }
      if ("stock" in patch) { if (patch.stock == null) delete cur.stock; else cur.stock = patch.stock; }
      const next = { ...prev, [key]: cur };
      try { localStorage.setItem("ow_enroll_draft", JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, []);
  const effPrice = useCallback((r: ActivityRow): number | null => {
    const d = enrollDraft[enrollKey(r)]?.price;
    return d != null ? d : (r.suggested_price != null ? r.suggested_price : r.signup_price);
  }, [enrollDraft, enrollKey]);
  const skuMinStock = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of actRows) {
      const s = Number(r.activity_stock);
      if (!r.sku_ext_code || !Number.isFinite(s) || s <= 0) continue;
      const cur = m.get(r.sku_ext_code);
      if (cur == null || s < cur) m.set(r.sku_ext_code, s);
    }
    return m;
  }, [actRows]);
  const effStock = useCallback((r: ActivityRow): number => {
    const d = enrollDraft[enrollKey(r)]?.stock;
    if (d != null) return d;
    if (r.sku_ext_code && skuMinStock.has(r.sku_ext_code)) return skuMinStock.get(r.sku_ext_code)!;
    return r.activity_stock || 0;
  }, [enrollDraft, enrollKey, skuMinStock]);
  const submitViaExtension = useCallback(async () => {
    const rows = selActRows;
    if (!rows.length) { message.warning("请先勾选要报名的行"); return; }
    const api = window.electronAPI?.erp?.enroll?.create;
    if (!api) { message.error("当前桌面端不支持(请重启/更新应用)"); return; }
    const bad = rows.filter(r => !r.product_id || !r.skc_id || !r.sku_id || !r.activity_id);
    if (bad.length) { message.error(`有 ${bad.length} 行缺 ID,走扩展路需完整 ID`); return; }
    const noPrice = rows.filter(r => effPrice(r) == null);
    if (noPrice.length) { message.error(`有 ${noPrice.length} 行没填申报价`); return; }
    const groups = new Map<string, { mall_id: string; activity_type: number | null; activity_thematic_id: string; prod: Map<string, { productId: number; activityStock: number; skc: Map<string, Map<string, number>> }> }>();
    for (const r of rows) {
      const k = `${r.mall_id}|${r.activity_id}|${r.activity_type ?? ""}`;
      if (!groups.has(k)) groups.set(k, { mall_id: r.mall_id, activity_type: r.activity_type, activity_thematic_id: r.activity_id!, prod: new Map() });
      const g = groups.get(k)!;
      if (!g.prod.has(r.product_id!)) g.prod.set(r.product_id!, { productId: Number(r.product_id), activityStock: effStock(r), skc: new Map() });
      const pe = g.prod.get(r.product_id!)!;
      pe.activityStock = effStock(r);
      if (!pe.skc.has(r.skc_id!)) pe.skc.set(r.skc_id!, new Map());
      pe.skc.get(r.skc_id!)!.set(r.sku_id!, Math.round(effPrice(r)! * 100));
    }
    const tasks = [...groups.values()].map(g => ({
      mall_id: g.mall_id, site: "agentseller", activity_type: g.activity_type, activity_thematic_id: g.activity_thematic_id,
      product_list: [...g.prod.values()].map(pe => ({
        productId: pe.productId, activityStock: pe.activityStock,
        skcList: [...pe.skc.entries()].map(([skcId, skuMap]) => ({ skcId: Number(skcId), skuList: [...skuMap.entries()].map(([skuId, activityPrice]) => ({ skuId: Number(skuId), activityPrice })) })),
      })),
    }));
    const lossRows = rows.filter(r => { const p = effPrice(r); return p != null && r.cost != null && p < r.cost; });
    Modal.confirm({
      title: "下发报名任务(扩展执行)", width: 560,
      content: (
        <div style={{ fontSize: 13 }}>
          <p>共 <b>{rows.length}</b> 行 → <b>{tasks.length}</b> 个任务,下发到云端,由浏览器扩展自动报名。</p>
          {lossRows.length > 0 && <p style={{ color: "#cf1322", fontWeight: 600 }}>{lossRows.length} 行申报价低于成本(亏本)</p>}
          <p style={{ color: "#888" }}>需对应店铺的 Chrome 开着(装了扩展)才会执行。</p>
        </div>
      ),
      okText: lossRows.length > 0 ? "仍然下发(含亏本)" : "下发任务",
      okButtonProps: { danger: lossRows.length > 0 }, cancelText: "取消",
      onOk: async () => {
        setEnrollBusy(true);
        try {
          const resp = await api({ tasks });
          const out = resp?.data?.rows || [];
          const ok = out.filter((x: { ok: boolean }) => x.ok).length;
          if (ok) { message.success(`已下发 ${ok}/${out.length} 个报名任务`); setSelActRows([]); }
          else message.error("下发失败:" + (out[0]?.error || resp?.error || "未知"));
        } catch (e: any) { message.error("下发失败:" + (e?.message || String(e))); }
        finally { setEnrollBusy(false); }
      },
    });
  }, [selActRows, effPrice, effStock]);
  const modalFiltered = useMemo(() => {
    if (modalStatusFilter === "全部") return modalActRows;
    return modalActRows.filter(r => r.status === modalStatusFilter);
  }, [modalActRows, modalStatusFilter]);
  const modalStatusCounts = useMemo(() => {
    const c: Record<string, number> = { "全部": modalActRows.length };
    for (const r of modalActRows) { const s = r.status || "未知"; c[s] = (c[s] || 0) + 1; }
    return c;
  }, [modalActRows]);
  const enrollColumns = useMemo<ColumnsType<ModalActRow>>(() => [
    { title: "SKU属性集", key: "spec", width: 120, render: (_, r) => r.color_spec || <span style={{ color: "#bbb" }}>—</span> },
    { title: "日常申报价", dataIndex: "signup_price", width: 100, align: "right", render: (v) => v != null ? `¥${v.toFixed(2)}` : <span style={{ color: "#bbb" }}>—</span> },
    { title: "活动申报价", key: "bid", width: 120, align: "right", render: (_, r) => {
      const v = effPrice(r); const loss = v != null && r.cost != null && v < r.cost;
      return <InputNumber size="small" min={0} step={0.01} precision={2} value={v ?? undefined} status={loss ? "error" : undefined} style={{ width: 100 }} onChange={val => setDraft(enrollKey(r), { price: val == null ? null : Number(val) })} />;
    } },
    { title: "报名时间", key: "enroll_at", width: 160, render: (_, r) => r.enroll_at || <span style={{ color: "#bbb" }}>—</span> },
    { title: "活动类型", key: "title", width: 280, ellipsis: true, render: (_, r) => {
      const typeLabel = (r.activity_type != null && ACTIVITY_TYPE_LABEL[r.activity_type]) || KIND_LABEL[r.kind || ""] || "";
      return <span>{typeLabel ? typeLabel + " " : ""}{r.title || <span style={{ color: "#bbb" }}>(未命名)</span>}</span>;
    } },
    { title: "报名场次", key: "sites", width: 260, render: (_, r) => {
      const s = r.sites || [];
      if (!s.length) return <span style={{ color: "#bbb" }}>—</span>;
      const show = s.slice(0, 2);
      const rest = s.length - 2;
      return (<div style={{ fontSize: 12, lineHeight: "20px" }}>
        {show.map((n, i) => <div key={i}>{n}</div>)}
        {rest > 0 && <Popover trigger="click" title={`全部场次 (${s.length})`} content={<div style={{ maxHeight: 300, overflow: "auto", fontSize: 13, lineHeight: "24px" }}>{s.map((n, i) => <div key={i}>{n}</div>)}</div>}><a style={{ fontSize: 12 }}>更多 (+{rest})</a></Popover>}
      </div>);
    } },
    { title: "提报数量", dataIndex: "activity_stock", width: 90, align: "right", render: (v: number) => v > 0 ? fmtNum(v) : <span style={{ color: "#bbb" }}>0</span> },
    { title: "剩余数量", key: "stock", width: 110, align: "right", render: (_, r) => <InputNumber size="small" min={0} precision={0} value={effStock(r)} style={{ width: 80 }} onChange={val => setDraft(enrollKey(r), { stock: val == null ? null : Number(val) })} /> },
    { title: "活动状态", key: "status", width: 80, render: (_, r) => {
      const s = r.status; if (!s) return <span style={{ color: "#bbb" }}>—</span>;
      return <Tag color={s === "进行中" ? "green" : s === "已报名" ? "blue" : s === "未开始" ? "orange" : s === "已结束" ? "default" : "default"} style={{ margin: 0 }}>{s}</Tag>;
    } },
  ], [effPrice, effStock, setDraft, enrollKey]);

  // 活动概览顶部汇总(我的店范围):优先用 temu_shop_stats 官方统计,全 0 时 fallback 到 actProductView 前端聚合

  const shopAgg = useMemo(() => {
    let lack = 0, soldout = 0, sales = 0;
    for (const r of shopRows) { if (!inScope(r.store_code || r.mall_id)) continue; lack += r.lack_skc || 0; soldout += r.already_sold_out || 0; sales += r.sale_volume || 0; }
    return { lack, soldout, sales };
  }, [shopRows, inScope]);
  const overviewTrend = useMemo(() => {
    if (activeTab !== "overview") return [] as { date: string; sales: number }[];
    const byDate = new Map<string, number>();
    for (const r of trendRows) { if (!inScope(r.store_code || r.mall_id)) continue; byDate.set(r.stat_date, (byDate.get(r.stat_date) || 0) + r.sales); }
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, sales]) => ({ date, sales }));
  }, [activeTab, trendRows, inScope]);
  // storeMatrix 辅助数据预处理:各数据源按店铺分组,仅依赖对应原始数组,避免任一数据源更新导致全量重算
  const riskByShop = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of riskRows) {
      if (r.severity !== "high" || !inScope(r.store_code || r.mall_id)) continue;
      const k = r.store_code || r.mall_id;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [riskRows, inScope]);
  const restockByShop = useMemo(() => {
    const m = new Map<string, number>();
    const need = (r: SkuRow) => (r.stock || 0) <= 0 || (r.sale_days != null && r.sale_days < 14) || (r.advice_qty || 0) > 0;
    for (const r of skuRows) {
      if (!need(r) || !inScope(r.store_code || r.mall_id)) continue;
      const k = r.store_code || r.mall_id;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [skuRows, inScope]);
  const stockGapByShop = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stockRows) {
      if (!inScope(r.store_code || r.mall_id)) continue;
      const k = r.store_code || r.mall_id;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [stockRows, inScope]);
  const actByShop = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of actRows) {
      if (!inScope(r.store_code || r.mall_id)) continue;
      const k = r.store_code || r.mall_id;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [actRows, inScope]);
  const lifecycleByMall = useMemo(() => {
    const seenSkc = new Map<string, string>();
    for (const r of lifecycleRows) { if (!r.skc_id || !r.status || !inScope(r.mall_id)) continue; seenSkc.set(r.mall_id + "|" + r.skc_id, r.status); }
    const m = new Map<string, Record<string, number>>();
    for (const [k, status] of seenSkc) {
      const mallId = k.split("|")[0];
      const label = selectStatusLabel(status);
      if (!m.has(mallId)) m.set(mallId, {});
      const lc = m.get(mallId)!;
      lc[label] = (lc[label] || 0) + 1;
    }
    return m;
  }, [lifecycleRows, inScope]);
  const firstShipByMall = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of firstShipRows) { if (!inScope(r.store_code || r.mall_id)) continue; m.set(r.mall_id, (m.get(r.mall_id) || 0) + 1); }
    return m;
  }, [firstShipRows, inScope]);
  const goodsCreatedByMall = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of goodsCreatedRows) { if (!inScope(r.store_code || r.mall_id)) continue; m.set(r.mall_id, (m.get(r.mall_id) || 0) + 1); }
    return m;
  }, [goodsCreatedRows, inScope]);
  const storeMatrix = useMemo(() => {
    if (activeTab !== "overview") return [] as StoreMatrixRow[];
    const m = new Map<string, StoreMatrixRow>();
    // shopRows 提供基础店铺信息(销量/缺货/售罄等)
    for (const r of shopRows) {
      if (!inScope(r.store_code || r.mall_id)) continue;
      const code = r.store_code || r.mall_id;
      m.set(code, { store_code: code, mall_id: r.mall_id, mall_name: r.mall_name, owner: r.owner, sales: r.sale_volume, sale_7d: r.sale_7d, lack: r.lack_skc, soldout: r.already_sold_out, high_risk: riskByShop.get(code) || 0, restock: restockByShop.get(code) || 0, stock_gap: stockGapByShop.get(code) || 0, activity: actByShop.get(code) || 0, lc: {}, first_ship: 0, goods_created: 0 });
    }
    // 各店上新生命周期阶段数/今日首单/今日创建:按 mall_id 匹配已建档店
    const byMall = new Map<string, StoreMatrixRow>();
    for (const e of m.values()) byMall.set(e.mall_id, e);
    for (const [mallId, lc] of lifecycleByMall) { const e = byMall.get(mallId); if (e) e.lc = { ...lc }; }
    for (const [mallId, cnt] of firstShipByMall) { const e = byMall.get(mallId); if (e) e.first_ship = cnt; }
    for (const [mallId, cnt] of goodsCreatedByMall) { const e = byMall.get(mallId); if (e) e.goods_created = cnt; }
    // 各店概览只显示已建档的店（有真实店号）；没建档的店 store_code 被 mall_id 顶替，过滤掉
    return [...m.values()].filter((e) => e.store_code !== e.mall_id).sort((a, b) => (b.lack + b.soldout + b.high_risk * 5) - (a.lack + a.soldout + a.high_risk * 5));
  }, [activeTab, shopRows, riskByShop, restockByShop, stockGapByShop, actByShop, lifecycleByMall, firstShipByMall, goodsCreatedByMall, inScope]);
  const panelBase = useMemo(() => {
    if (activeTab !== "product") return [] as ProductPanelRow[];
    let v = panelRows.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.product_id || "").includes(q) || (r.skc_codes || "").includes(q) || (r.sku_codes || "").includes(q));
    return v;
  }, [activeTab, panelRows, storeFilter, search, inScope]);
  const slowCount = useMemo(() => panelBase.filter(isSlowMoving).length, [panelBase]);
  const panelView = useMemo(() => {
    let v = slowFilter === "slow" ? panelBase.filter(isSlowMoving) : panelBase;
    if (onsaleDaysFilter !== "all") {
      const d = Number(onsaleDaysFilter);
      if (d === 0) v = v.filter((r) => !r.onsales_duration || r.onsales_duration <= 0);
      else v = v.filter((r) => { const days = r.onsales_duration ?? 0; return days > 0 && days <= d; });
    }
    return v.map((r, i) => ({ ...r, __rk: i }));
  }, [panelBase, slowFilter, onsaleDaysFilter]);
  // 官方流量(店铺维度)：用 shopRows 把 mall_id 映射成店名/store_code，沿用 owner/store 过滤
  const stockView = useMemo(() => {
    if (activeTab !== "stock" && activeTab !== "overview") return [] as (StockOrderRow & { __rk: number })[];
    let v = stockRows.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q) || (r.order_no || "").toLowerCase().includes(q));
    return v.map((r, i) => ({ ...r, __rk: i }));
  }, [activeTab, stockRows, storeFilter, search, inScope]);
  // column 定义:纯静态的已移到组件外部(storeColStatic / diagColumnsStatic / restockColumnsStatic 等)
  // 以下仅保留引用组件 state/回调的 column 定义,用 useMemo 包裹


  // stockColumns / storeMatrixColumns / riskColumns / restockColumns / diagColumns / qualityColumns 已移到组件外部(纯静态)

  const nowHour = new Date().getHours();
  const adviceOf = useCallback((r: ProductPanelRow) => { const skus = skusOfFn(r); return calcAdvice(skus.reduce((a, s) => a + (s.today || 0), 0), skus.reduce((a, s) => a + (s.last7d || 0), 0), r.total_stock || 0, nowHour); }, [nowHour]);

  const qcColumns = useMemo<ColumnsType<QcRow>>(() => [
    { title: "店号", dataIndex: "store_code", width: 78, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
    { title: "商品", key: "prod", width: 280, render: (_, r) => (<div style={{ display: "flex", gap: 8, alignItems: "center" }}>{r.thumb_url ? <div style={{ flexShrink: 0, width: 64, height: 64 }}><Image src={r.thumb_url} width={64} height={64} style={{ objectFit: "cover", borderRadius: 4 }} /></div> : <div style={{ width: 64, height: 64, background: "#f0f0f0", borderRadius: 4, flexShrink: 0 }} />}<div style={{ minWidth: 0 }}><div style={{ fontSize: 12, lineHeight: 1.4, maxHeight: 34, overflow: "hidden" }}>{r.sku_name || "—"}</div><div style={{ fontSize: 11, color: "#8c8c8c" }}>{r.spec || ""}{r.ext_code ? ` · ${r.ext_code}` : ""}</div></div></div>) },
    { title: "采购单", dataIndex: "purchase_no", width: 150, render: (v) => v ? <Typography.Text copyable={{ text: String(v) }} style={{ fontSize: 12 }}>{v}</Typography.Text> : "—" },
    { title: "结果", dataIndex: "qc_result", width: 76, align: "center", render: (v) => v === 2 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>不合格</span> : v === 1 ? <span style={{ color: "#3f8600" }}>合格</span> : "—" },
    { title: "疵点原因", dataIndex: "flaw_summary", width: 320, render: (v) => v ? <span style={{ color: "#cf1322", fontSize: 12 }}>{v}</span> : <span style={{ color: "#bbb" }}>—</span> },
    { title: "疵点图", key: "flaw", width: 86, align: "center", render: (_, r) => {
      if (!r.flaw_image_count) return <span style={{ color: "#bbb" }}>—</span>;
      if (!r.flaw_thumb) return <a onClick={() => openFlawImages(r.mall_id, r.qc_bill_id)}>{r.flaw_image_count} 张</a>;
      return <a onClick={() => openFlawImages(r.mall_id, r.qc_bill_id)} style={{ position: "relative", display: "inline-block", lineHeight: 0 }} title={`${r.flaw_image_count} 张疵点照片,点击查看`}>
        <img src={r.flaw_thumb} width={64} height={64} style={{ objectFit: "cover", borderRadius: 4, border: "1px solid #f0f0f0" }} alt="" />
        <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, padding: "0 4px", borderRadius: 3, lineHeight: "15px" }}>{r.flaw_image_count}</span>
      </a>;
    } },
    { title: "次品/应检", key: "qty", width: 92, align: "right", render: (_, r) => `${r.defective_qty ?? "—"} / ${r.expect_qty ?? "—"}` },
    { title: "收货单", dataIndex: "receipt_no", width: 150, render: (v) => v || "—" },
    { title: "类目", dataIndex: "cat_name", width: 120, ellipsis: true, render: (v) => v || "—" },
    { title: "质检时间", dataIndex: "qc_result_update_time", width: 150, render: (v) => v ? String(v).slice(0, 19).replace("T", " ") : "—", sorter: (a, b) => String(a.qc_result_update_time || "").localeCompare(String(b.qc_result_update_time || "")), defaultSortOrder: "descend" },
  ], [openFlawImages]);

  const panelColumns = useMemo<ColumnsType<ProductPanelRow>>(() => [
    { title: "店号", dataIndex: "store_code", width: 88, fixed: "left", render: (v, r) => <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>{formatStoreNo(v === r.mall_id ? null : v, r.mall_id)}</div> },
    { title: "商品", key: "prod", width: 410, render: (_, r) => {
      const codes = (r.skc_codes || "").split(",").map((c) => c.trim()).filter(Boolean);
      return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {r.thumb ? <div style={{ flexShrink: 0, width: 56, height: 56 }}><Image src={r.thumb} width={56} height={56} style={{ objectFit: "cover", borderRadius: 4 }} preview={{ mask: <EyeOutlined />, maskClassName: "prod-thumb-mask" }} /></div> : <div style={{ width: 56, height: 56, borderRadius: 4, background: "#f0f0f0", flexShrink: 0 }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: "normal", wordBreak: "break-word" }}>{r.title || "—"}</div>
          <div style={{ marginTop: 4, fontSize: 13, color: "#8c8c8c", display: "flex", flexWrap: "wrap", gap: "0 10px" }}>
            <span>SPU <Typography.Text copyable={{ text: String(r.product_id) }} style={{ fontSize: 13, color: "#8c8c8c" }}>{r.product_id}</Typography.Text></span>
            {codes.map((c, i) => <span key={i}>SKC <Typography.Text copyable={{ text: c }} style={{ fontSize: 13, color: "#8c8c8c" }}>{c}</Typography.Text></span>)}
            {!OFFICIAL_SOURCE && <a onClick={(e) => { e.stopPropagation(); setTrendOf({ productId: String(r.product_id), title: r.title || String(r.product_id) }); }} style={{ fontSize: 11 }}>销量趋势</a>}
          </div>
          {(r.hot_tag || r.has_hot_sku || (r.onsales_duration && r.onsales_duration > 0)) ? <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {r.hot_tag ? <Tag color="red" style={{ fontSize: 12, marginInlineEnd: 0, lineHeight: "20px", padding: "0 8px", fontWeight: 500, borderRadius: 10 }}>热销款</Tag> : null}
            {r.has_hot_sku ? <Tag color="volcano" style={{ fontSize: 12, marginInlineEnd: 0, lineHeight: "20px", padding: "0 8px", fontWeight: 500, borderRadius: 10 }}>爆旺SKU</Tag> : null}
            {r.onsales_duration && r.onsales_duration > 0 ? <Tag color="blue" style={{ fontSize: 12, marginInlineEnd: 0, lineHeight: "20px", padding: "0 8px", fontWeight: 500, borderRadius: 10 }}>加入站点 {fmtNum(r.onsales_duration)} 天</Tag> : null}
          </div> : null}
        </div>
      </div>
      </div>
      );
    } },
    { title: "SKU货号", key: "sku_ext", width: 130, render: (_, r) => stackCell(skusOfFn(r), (s) => s.sku_ext_code || <span style={{ color: "#bbb" }}>—</span>) },
    { title: "规格", key: "spec", width: 150, render: (_, r) => stackCell(skusOfFn(r), (s) => s.spec_name ? <span style={{ color: "#595959" }}>{s.spec_name}</span> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "评价", key: "score", width: 110, align: "right", sorter: (a, b) => (a.comments ?? 0) - (b.comments ?? 0), render: (_, r) => { if (r.comments == null && r.score == null) return <span style={{ color: "#bbb" }}>—</span>; return <span>{r.score != null ? <span style={{ color: "#fadb14" }}>★{r.score.toFixed(1)} </span> : null}{r.comments != null ? <span>{fmtNum(r.comments)} 评论</span> : ""}</span>; } },
    { title: "申报价", key: "declared_price", width: 90, align: "right", render: (_, r) => { const skus = skusOfFn(r); const prices = skus.map((s) => s.declared_price).filter((p): p is number => p != null); const min = prices.length ? Math.min(...prices) : null; return stackCell(skus, (s) => (s.declared_price == null ? "—" : "¥" + s.declared_price.toFixed(2)), min == null ? "—" : "¥" + min.toFixed(2)); } },
    { title: "今日销量", key: "today_sales", width: 90, align: "right", sorter: (a, b) => skusOfFn(a).reduce((x, s) => x + (s.today || 0), 0) - skusOfFn(b).reduce((x, s) => x + (s.today || 0), 0), defaultSortOrder: "descend", render: (_, r) => { const skus = skusOfFn(r); const sum = skus.reduce((a, s) => a + (s.today || 0), 0); return stackCell(skus, (s) => fmtNum(s.today), fmtNum(sum), true); } },
    { title: "7天销量", key: "sales_7d", width: 95, align: "right", sorter: (a, b) => skusOfFn(a).reduce((x, s) => x + (s.last7d || 0), 0) - skusOfFn(b).reduce((x, s) => x + (s.last7d || 0), 0), render: (_, r) => { const skus = skusOfFn(r); const sum = skus.reduce((a, s) => a + (s.last7d || 0), 0); return stackCell(skus, (s) => fmtNum(s.last7d), fmtNum(sum)); } },
    { title: "30天销量", key: "sales_30d", width: 95, align: "right", sorter: (a, b) => skusOfFn(a).reduce((x, s) => x + (s.last30d || 0), 0) - skusOfFn(b).reduce((x, s) => x + (s.last30d || 0), 0), render: (_, r) => { const skus = skusOfFn(r); const sum = skus.reduce((a, s) => a + (s.last30d || 0), 0); return stackCell(skus, (s) => fmtNum(s.last30d), fmtNum(sum)); } },
    { title: "可用库存", key: "stock", width: 108, align: "right", sorter: (a, b) => skusOfFn(a).reduce((x, s) => x + (s.stock || 0), 0) - skusOfFn(b).reduce((x, s) => x + (s.stock || 0), 0), render: (_, r) => { const skus = skusOfFn(r); const sum = skus.reduce((a, s) => a + (s.stock || 0), 0); return stackCell(skus, (s) => <span style={{ color: (s.stock || 0) <= 0 ? "#cf1322" : undefined }}>{fmtNum(s.stock)}</span>, fmtNum(sum)); } },
    { title: "预占用库存", key: "occupy", width: 116, align: "right", sorter: (a, b) => skusOfFn(a).reduce((x, s) => x + (s.occupy || 0), 0) - skusOfFn(b).reduce((x, s) => x + (s.occupy || 0), 0), render: (_, r) => { const skus = skusOfFn(r); const sum = skus.reduce((a, s) => a + (s.occupy || 0), 0); return stackCell(skus, (s) => fmtNum(s.occupy), fmtNum(sum)); } },
    { title: "暂不可用库存", key: "unavail", width: 130, align: "right", sorter: (a, b) => skusOfFn(a).reduce((x, s) => x + (s.unavail_stock || 0), 0) - skusOfFn(b).reduce((x, s) => x + (s.unavail_stock || 0), 0), render: (_, r) => { const skus = skusOfFn(r); const sum = skus.reduce((a, s) => a + (s.unavail_stock || 0), 0); return stackCell(skus, (s) => ((s.unavail_stock || 0) > 0 ? <span style={{ color: "#d46b08" }}>{fmtNum(s.unavail_stock || 0)}</span> : <span>0</span>), sum > 0 ? <span style={{ color: "#d46b08" }}>{fmtNum(sum)}</span> : fmtNum(sum)); } },
    { title: "缺货件数", key: "lack_qty", width: 110, align: "right", sorter: (a, b) => (a.lack_qty ?? 0) - (b.lack_qty ?? 0), render: (_, r) => { const skus = skusOfFn(r); const sum = skus.reduce((a, s) => a + (s.lack_qty || 0), 0); return stackCell(skus, (s) => ((s.lack_qty || 0) > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtNum(s.lack_qty || 0)}</span> : <span style={{ color: "#bbb" }}>0</span>), sum > 0 ? <span style={{ color: "#cf1322" }}>{fmtNum(sum)}</span> : fmtNum(sum)); } },
    { title: "在途库存", key: "shipping", width: 108, align: "right", sorter: (a, b) => skusOfFn(a).reduce((x, s) => x + (s.shipping || 0), 0) - skusOfFn(b).reduce((x, s) => x + (s.shipping || 0), 0), render: (_, r) => { const skus = skusOfFn(r); const sum = skus.reduce((a, s) => a + (s.shipping || 0), 0); return stackCell(skus, (s) => ((s.shipping || 0) > 0 ? <span style={{ color: "#1677ff" }}>{fmtNum(s.shipping || 0)}</span> : <span style={{ color: "#bbb" }}>0</span>), sum > 0 ? <span style={{ color: "#1677ff" }}>{fmtNum(sum)}</span> : <span style={{ color: "#bbb" }}>0</span>); } },
    { title: "总库存", key: "total_stock", width: 104, align: "right", sorter: (a, b) => (a.total_stock ?? 0) - (b.total_stock ?? 0), render: (_, r) => { const skus = skusOfFn(r); const skuTotal = (s: SkuChild) => (s.stock || 0) + (s.unavail_stock || 0) - (s.lack_qty || 0) + (s.shipping || 0); const sum = skus.reduce((a, s) => a + skuTotal(s), 0); return stackCell(skus, (s) => { const v = skuTotal(s); return <span style={{ fontWeight: 700, color: v <= 0 ? "#cf1322" : "#1a73e8" }}>{fmtNum(v)}</span>; }, <span style={{ fontWeight: 700, color: sum <= 0 ? "#cf1322" : "#1a73e8" }}>{fmtNum(sum)}</span>); } },
    { title: "建议备货", key: "advice", width: 108, align: "right", sorter: (a, b) => adviceOf(a) - adviceOf(b), render: (_, r) => { const skus = skusOfFn(r); const sum = skus.reduce((a, s) => a + (s.advice_qty || 0), 0); return stackCell(skus, (s) => (s.advice_qty > 0 ? <span style={{ color: "#1677ff" }}>{fmtNum(s.advice_qty)}</span> : <span style={{ color: "#bbb" }}>—</span>), sum > 0 ? <Tag color="blue">{fmtNum(sum)}</Tag> : <span style={{ color: "#bbb" }}>—</span>); } },
    { title: "可售天数", key: "sellthrough", width: 112, align: "right", sorter: (a, b) => { const x = sellThroughDays(a), y = sellThroughDays(b); return (x === Infinity ? 1e9 : x) - (y === Infinity ? 1e9 : y); }, render: (_, r) => { const skus = skusOfFn(r); const skuDays = (s: SkuChild) => { const avg = (s.last7d || 0) / 7; return avg > 0 ? (s.stock || 0) / avg : 0; }; const d = sellThroughDays(r); const fmtD = (v: number) => v <= 0 ? <span style={{ color: "#bbb" }}>—</span> : <span style={{ color: v > 14 ? "#d46b08" : "#595959" }}>{Math.round(v)} 天</span>; if (d === 0) return stackCell(skus, () => <span style={{ color: "#bbb" }}>—</span>, <span style={{ color: "#bbb" }}>—</span>); const txt = d === Infinity ? "∞" : Math.round(d) + " 天"; const sumEl = isSlowMoving(r) ? <Tag color="orange">{txt} · 滞销</Tag> : <span style={{ color: d > 14 ? "#d46b08" : "#595959" }}>{txt}</span>; return stackCell(skus, (s) => fmtD(skuDays(s)), sumEl); } },
    { title: "可报活动", key: "act", width: 130, align: "right", sorter: (a, b) => a.act_cnt - b.act_cnt, render: (_, r) => (r.act_cnt > 0 ? <span style={{ color: "#3f8600" }}>{r.act_cnt}个{r.min_price != null ? ` / 低¥${r.min_price.toFixed(2)}` : ""}</span> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "合规", dataIndex: "compliance", width: 170, render: (v: string | null) => (v ? <Tag color="red" style={{ whiteSpace: "normal" }}>{v}</Tag> : <span style={{ color: "#3f8600" }}>正常</span>) },
    { title: "限流", dataIndex: "limited", width: 90, align: "center", sorter: (a, b) => (a.limited ? 1 : 0) - (b.limited ? 1 : 0), render: (v: boolean) => (v ? <Tag color="volcano">高价限流</Tag> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "曝光", dataIndex: "expose", width: 80, align: "right", sorter: (a, b) => (a.expose || 0) - (b.expose || 0), render: (v: number | null) => (v == null ? <span style={{ color: "#ccc" }}>无</span> : fmtNum(v)) },
    { title: "点击", dataIndex: "click", width: 70, align: "right", render: (v: number | null) => (v == null ? "—" : fmtNum(v)) },
    { title: "支付件", dataIndex: "pay", width: 75, align: "right", render: (v: number | null) => (v == null ? "—" : fmtNum(v)) },
    { title: "曝光转化", dataIndex: "conv", width: 90, align: "right", render: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(2) + "%") },
  ], [setTrendOf, adviceOf]);

  const hpfColumns = useMemo<ColumnsType<HpfRow>>(() => [
    { title: "店号", dataIndex: "store_code", width: 78, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
    { title: "店铺", dataIndex: "mall_name", width: 120, ellipsis: true, render: (v: string | null) => formatMallName(v) },
    { title: "商品", key: "prod", width: 380, render: (_, r) => (
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {r.thumb ? <div style={{ flexShrink: 0, width: 52, height: 52 }}><Image src={r.thumb} width={52} height={52} style={{ objectFit: "cover", borderRadius: 4 }} preview={{ mask: <EyeOutlined /> }} /></div> : <div style={{ width: 52, height: 52, borderRadius: 4, background: "#f0f0f0", flexShrink: 0 }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: "normal", wordBreak: "break-word" }}>{r.title || "—"}</div>
          {r.sku_codes ? <div style={{ fontSize: 11, color: "#8c8c8c", marginTop: 1 }}>{r.sku_codes}</div> : null}
          <div style={{ marginTop: 3, display: "flex", flexWrap: "wrap", gap: "0 8px", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#8c8c8c" }}>SPU <Typography.Text copyable={{ text: String(r.product_id) }} style={{ fontSize: 12, color: "#8c8c8c" }}>{r.product_id}</Typography.Text></span>
            {r.skc_id ? <span style={{ fontSize: 12, color: "#8c8c8c" }}>SKC <Typography.Text copyable={{ text: String(r.skc_id) }} style={{ fontSize: 12, color: "#8c8c8c" }}>{r.skc_id}</Typography.Text></span> : null}
          </div>
        </div>
      </div>
    ) },
    { title: "流量下降率", dataIndex: "decline_rate", width: 150, defaultSortOrder: "descend" as const, sorter: (a, b) => (a.decline_rate || 0) - (b.decline_rate || 0), render: (v: number | null) => v == null ? <span style={{ color: "#bbb" }}>—</span> : (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Progress percent={Math.min(v, 100)} size="small" strokeColor={v >= 50 ? "#cf1322" : v >= 20 ? "#d46b08" : "#faad14"} showInfo={false} style={{ flex: 1, margin: 0 }} />
        <span style={{ color: v >= 50 ? "#cf1322" : "#d46b08", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>↓{v.toFixed(1)}%</span>
      </div>
    ) },
    { title: "建议调价", key: "advise_price", width: 150, align: "right", render: (_, r) => { const cur = r.current_price != null ? r.current_price : r.declared_price; if (r.target_price == null) return cur != null ? <span style={{ fontSize: 12, color: "#888" }}>¥{cur.toFixed(2)}</span> : <span style={{ color: "#bbb" }}>—</span>; const cut = cur && cur > 0 ? Math.round((1 - r.target_price / cur) * 100) : null; return <div style={{ fontSize: 12 }}>{cur != null ? <div style={{ color: "#999", textDecoration: "line-through", fontSize: 11 }}>¥{cur.toFixed(2)}</div> : null}<div style={{ color: "#cf1322", fontWeight: 700 }}>¥{r.target_price.toFixed(2)}{cut != null ? <span style={{ fontWeight: 400, fontSize: 11 }}> (-{cut}%)</span> : null}</div></div>; } },
    { title: "可用库存", dataIndex: "stock", width: 90, align: "right", sorter: (a, b) => (a.stock || 0) - (b.stock || 0), render: (v: number | null) => v == null ? "—" : <span style={{ color: v <= 0 ? "#cf1322" : undefined, fontWeight: v <= 0 ? 700 : undefined }}>{fmtNum(v)}</span> },
    { title: "7天销量", dataIndex: "last7d_sales", width: 85, align: "right", sorter: (a, b) => (a.last7d_sales || 0) - (b.last7d_sales || 0), render: (v: number | null) => v == null ? "—" : fmtNum(v) },
    { title: "状态", key: "frs", width: 90, filters: [{ text: "已限流", value: 1 }, { text: "即将限流", value: 2 }], onFilter: (v, r) => (r.flow_reduce_status ?? 1) === v, render: (_, r) => r.flow_reduce_status === 2 ? <Tag color="orange">即将限流</Tag> : <Tag color="red">已限流</Tag> },
    { title: "最近限流日", dataIndex: "last_seen_date", width: 100, render: (v: string | null) => v || "—" },
  ], [setTrendOf, openHpfDetail]);

  const commonFilters = useCallback((extra?: React.ReactNode) => (
    <OpsCommonFilters storeFilter={storeFilter} onStoreChange={setStoreFilter} storeOptions={storeOptions} searchInput={searchInput} onSearchChange={setSearchInput} extra={extra} />
  ), [storeFilter, setStoreFilter, storeOptions, searchInput, setSearchInput]);

  const qcView = useMemo(() => {
    if (activeTab !== "qc") return [] as QcRow[];
    const kw = search.trim().toLowerCase();
    return qcRows.filter((r) => {
      if (!inScope(r.store_code || r.mall_id)) return false;
      if (storeFilter !== "all" && r.store_code !== storeFilter) return false;
      if (!kw) return true;
      return [r.sku_name, r.ext_code, r.purchase_no, r.cat_name, r.flaw_summary, r.store_code, r.receipt_no].some((x) => String(x || "").toLowerCase().includes(kw));
    });
  }, [activeTab, qcRows, search, storeFilter, inScope]);

  const [qualitySiteFilter, setQualitySiteFilter] = useSessionState(owViewKey("qualitySite"), "all");
  const qualityView = useMemo(() => {
    if (activeTab !== "quality") return [] as QualityRow[];
    const kw = search.trim().toLowerCase();
    return qualityRows.filter((r) => {
      if (!inScope(r.store_code || r.mall_id)) return false;
      if (storeFilter !== "all" && r.store_code !== storeFilter) return false;
      if (qualitySiteFilter !== "all" && r.site !== qualitySiteFilter) return false;
      if (!kw) return true;
      return [r.product_name, r.product_id, r.goods_id, r.category_name, r.afs_problems, r.rev_problems, r.store_code].some((x) => String(x || "").toLowerCase().includes(kw));
    });
  }, [activeTab, qualityRows, search, storeFilter, qualitySiteFilter, inScope]);

  const qualityShopsView = useMemo(() => qualityShops.filter((s) => inScope(s.store_code || s.mall_id)), [qualityShops, inScope]);

  const qualityDist = useMemo(() => {
    let total = 0, hasScore = 0, danger = 0, warn = 0, good = 0, excellent = 0;
    let sum = 0;
    for (const r of qualityView) {
      total++;
      if (r.afs_score == null) continue;
      hasScore++;
      sum += r.afs_score;
      if (r.afs_score < 60) danger++;
      else if (r.afs_score < 75) warn++;
      else if (r.afs_score < 90) good++;
      else excellent++;
    }
    return { total, hasScore, danger, warn, good, excellent, avg: hasScore > 0 ? sum / hasScore : null };
  }, [qualityView]);

  const hpfView = useMemo(() => {
    if (activeTab !== "hpf") return [] as (HpfRow & { __rk: number })[];
    const kw = search.trim().toLowerCase();
    return hpfRows.filter((r) => {
      if (!r.store_code) return false;
      if (!inScope(r.store_code || r.mall_id)) return false;
      if (storeFilter !== "all" && r.store_code !== storeFilter) return false;
      if (hpfStatusFilter !== "all") {
        const st = Number(hpfStatusFilter);
        if (r.flow_reduce_status != null && r.flow_reduce_status !== st) return false;
        if (r.flow_reduce_status == null && st !== 1) return false;
      }
      if (!kw) return true;
      return [r.title, r.product_id, r.skc_id, r.sku_codes, r.store_code].some((x) => String(x || "").toLowerCase().includes(kw));
    }).map((r, i) => ({ ...r, __rk: i }));
  }, [activeTab, hpfRows, search, storeFilter, hpfStatusFilter, inScope]);
  const hpfAgg = useMemo(() => {
    if (activeTab !== "hpf") return { total: 0, avg: null as number | null, severe: 0, shops: 0, limited: 0, pending: 0 };
    let sum = 0, cnt = 0, severe = 0, limited = 0, pending = 0; const shops = new Set<string>();
    for (const r of hpfView) {
      if (r.decline_rate != null) { sum += r.decline_rate; cnt += 1; if (r.decline_rate >= 50) severe += 1; }
      shops.add(r.store_code || r.mall_id);
    }
    for (const r of hpfRows) {
      if (!r.store_code || !inScope(r.store_code || r.mall_id)) continue;
      if (r.flow_reduce_status === 2) pending++; else limited++;
    }
    return { total: hpfView.length, avg: cnt ? Number((sum / cnt).toFixed(1)) : null, severe, shops: shops.size, limited, pending };
  }, [activeTab, hpfView, hpfRows, inScope]);

  const [flowSiteFilter, setFlowSiteFilter] = useSessionState(owViewKey("flowSite"), "all");
  const flowView = useMemo(() => {
    if (activeTab !== "flux") return [] as FlowAnalysisRow[];
    const kw = search.trim().toLowerCase();
    return flowRows.filter((r) => {
      if (!r.mall_id) return false;
      if (!inScope(r.store_code || r.mall_id)) return false;
      if (storeFilter !== "all" && r.store_code !== storeFilter) return false;
      if (flowSiteFilter !== "all" && r.site !== flowSiteFilter) return false;
      if (!kw) return true;
      return [r.title, r.product_id, r.goods_id, r.category_name, r.store_code].some((x) => String(x || "").toLowerCase().includes(kw));
    });
  }, [activeTab, flowRows, search, storeFilter, flowSiteFilter, inScope]);

  const fmtRate = (v: number | null) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
  const fmtN = (v: number | null) => v == null ? "—" : v.toLocaleString();
  const flowColumns: ColumnsType<FlowAnalysisRow> = [
    { title: "店铺", dataIndex: "store_code", key: "store", width: 90, render: (v, r) => formatStoreNo(r.store_code, r.mall_name) || r.mall_id },
    { title: "区域", dataIndex: "site", key: "site", width: 60, align: "center" as const, render: (v: string | null) => { const m: Record<string, string> = { agentseller: "全球", "agentseller-us": "美区", "agentseller-eu": "欧区" }; return v ? <Tag color={v === "agentseller-us" ? "blue" : v === "agentseller-eu" ? "purple" : "green"}>{m[v] || v}</Tag> : <span style={{ color: "#bbb" }}>—</span>; } },
    { title: "商品", dataIndex: "title", key: "title", width: 240, ellipsis: true, render: (v, r) => (
      <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => {
        setFlowTrendOf({ mallId: r.mall_id, productId: r.product_id, goodsId: r.goods_id || "", site: r.site || "", title: v || r.product_id });
        setFlowTrendLoading(true);
        const sites = ["agentseller", "agentseller-us", "agentseller-eu"] as const;
        const suf = { agentseller: "全球", "agentseller-us": "美区", "agentseller-eu": "欧区" } as const;
        Promise.all(sites.map(s => fetchFlowTrend(r.mall_id, r.product_id, r.goods_id || "", s))).then(([g, u, e]) => {
          const dm = new Map<string, Record<string, any>>();
          [[g, "全球"], [u, "美区"], [e, "欧区"]].forEach(([data, label]) => {
            (data as FlowTrendPoint[]).forEach(p => {
              if (!dm.has(p.date)) dm.set(p.date, { date: p.date });
              const row = dm.get(p.date)!;
              row[`expose_${label}`] = p.expose;
              row[`ctr_${label}`] = p.ctr != null ? +p.ctr.toFixed(1) : null;
              row[`cvr_${label}`] = p.click_pay_rate != null ? +p.click_pay_rate.toFixed(1) : null;
            });
          });
          setFlowTrendRows([...dm.values()].sort((a, b) => a.date.localeCompare(b.date)));
        }).finally(() => setFlowTrendLoading(false));
      }}>
        {r.thumb_url && <img src={r.thumb_url} style={{ width: 28, height: 28, borderRadius: 4, objectFit: "cover", flexShrink: 0 }} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1677ff" }}>{v || r.product_id}</span>
      </div>
    ) },
    { title: "曝光", dataIndex: "expose", key: "expose", width: 80, align: "right", sorter: (a, b) => (a.expose ?? 0) - (b.expose ?? 0), defaultSortOrder: "descend" as const, render: fmtN },
    { title: "点击", dataIndex: "click", key: "click", width: 80, align: "right", sorter: (a, b) => (a.click ?? 0) - (b.click ?? 0), render: fmtN },
    { title: "CTR", dataIndex: "ctr", key: "ctr", width: 75, align: "right", sorter: (a, b) => (a.ctr ?? 0) - (b.ctr ?? 0), render: fmtRate },
    { title: "详情访客", dataIndex: "detail_visitor", key: "detail_visitor", width: 90, align: "right", sorter: (a, b) => (a.detail_visitor ?? 0) - (b.detail_visitor ?? 0), render: fmtN },
    { title: "加购", dataIndex: "add_cart", key: "add_cart", width: 70, align: "right", sorter: (a, b) => (a.add_cart ?? 0) - (b.add_cart ?? 0), render: fmtN },
    { title: "买家", dataIndex: "buyer", key: "buyer", width: 70, align: "right", sorter: (a, b) => (a.buyer ?? 0) - (b.buyer ?? 0), render: fmtN },
    { title: "支付件数", dataIndex: "pay_goods", key: "pay_goods", width: 90, align: "right", sorter: (a, b) => (a.pay_goods ?? 0) - (b.pay_goods ?? 0), render: fmtN },
    { title: "点击支付率", dataIndex: "click_pay_rate", key: "click_pay_rate", width: 100, align: "right", sorter: (a, b) => (a.click_pay_rate ?? 0) - (b.click_pay_rate ?? 0), render: (v) => <span style={{ color: v != null && v > 0 ? (v >= 0.03 ? "#3f8600" : v >= 0.01 ? "#d4b106" : "#cf1322") : undefined }}>{fmtRate(v)}</span> },
    { title: "搜索曝光", dataIndex: "search_expose", key: "search_expose", width: 90, align: "right", render: fmtN },
    { title: "推荐曝光", dataIndex: "recommend_expose", key: "recommend_expose", width: 90, align: "right", render: fmtN },
    { title: "增长状态", dataIndex: "grow", key: "grow", width: 90, render: (v, r) => v ? <Tag color={v === "待增长" ? "orange" : v === "增长中" ? "green" : v === "下降" ? "red" : "default"}>{v}{r.grow_text ? ` ${r.grow_text}` : ""}</Tag> : "—" },
    { title: "日期", dataIndex: "stat_date", key: "stat_date", width: 100 },
  ];

  const tabItems = useMemo(() => [
    {
      key: "overview", label: "总览",
      children: (
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <Card size="small"><Statistic title="今日销量(全店)" value={shopAgg.sales} /></Card>
            <Card size="small"><Statistic title="缺货 SKC" value={shopAgg.lack} valueStyle={{ color: shopAgg.lack > 0 ? "#d46b08" : undefined }} /></Card>
            <Card size="small"><Statistic title="已售罄" value={shopAgg.soldout} valueStyle={{ color: shopAgg.soldout > 0 ? "#cf1322" : undefined }} /></Card>
            {!HIDE_RISK && <Card size="small" hoverable onClick={() => setActiveTab("risk")}><Statistic title="高风险待办" value={riskOverview.high} valueStyle={{ color: riskOverview.high > 0 ? "#cf1322" : undefined }} /></Card>}
            {!HIDE_DIAG && <Card size="small" hoverable onClick={() => goProduct("diag")}><Statistic title="诊断 · 急" value={overview.urgent} valueStyle={{ color: overview.urgent > 0 ? "#cf1322" : undefined }} /></Card>}
            {!HIDE_RESTOCK && <Card size="small" hoverable onClick={() => goProduct("restock")}><Statistic title="急需补货 SKU" value={restockView.length} valueStyle={{ color: restockView.length > 0 ? "#d46b08" : undefined }} /></Card>}
            {!HIDE_STOCK && <Card size="small" hoverable onClick={() => setActiveTab("stock")}><Statistic title="备货缺口单" value={stockLoaded ? stockView.length : "查看"} valueStyle={!stockLoaded ? { fontSize: 16, color: "#1677ff" } : undefined} /></Card>}
            {!HIDE_ACTIVITY && <Card size="small" hoverable onClick={() => setActiveTab("activity")}><Statistic title="可报活动" value={actProductView.reduce((s, p) => s + p.act_count, 0)} valueStyle={{ color: "#3f8600" }} /></Card>}
          </div>
          <Card size="small" title="各店概览 · 点店看明细,问题多的店排前;后段列为各店上新生命周期阶段(SKC)" style={{ marginBottom: 16 }} loading={shopLoading || riskLoading || skuLoading || lifecycleLoading}>
            <Table<StoreMatrixRow> dataSource={storeMatrix} rowKey="store_code" size="small"
              pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 店` }}
              scroll={{ x: 1740 }}
              columns={storeMatrixColumnsStatic.filter((c) => !(HIDE_RISK && (c as { dataIndex?: string }).dataIndex === "high_risk") && !(HIDE_ACTIVITY && (c as { dataIndex?: string }).dataIndex === "activity"))}
              onRow={(r) => ({ onClick: () => navigate(`/ops-workbench/store/${r.mall_id}`), style: { cursor: "pointer" } })} />
          </Card>
          {!OFFICIAL_SOURCE && (<Card size="small" title="全店销量趋势 · 近 30 天" style={{ marginBottom: 16 }} loading={trendLoading}>
            <div style={{ height: 200 }}>
              {overviewTrend.length === 0 ? <Empty description="暂无趋势数据" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overviewTrend} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <RTooltip />
                    <Line type="monotone" dataKey="sales" name="全店销量" stroke="#1a73e8" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>)}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {!HIDE_RISK && (<Card size="small" title="高风险待办" extra={<a onClick={() => setActiveTab("risk")}>全部</a>} loading={riskLoading}>
              {riskView.filter((r) => r.severity === "high").slice(0, 6).map((r) => (
                <div key={r.__rk} style={{ padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <Tag color="red">{r.store_code || r.mall_id}</Tag>{r.title || r.risk_type || "—"}
                </div>
              ))}
              {riskView.filter((r) => r.severity === "high").length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无高风险</div>}
            </Card>)}
            {!HIDE_RESTOCK && (<Card size="small" title="急需补货" extra={<a onClick={() => goProduct("restock")}>全部</a>} loading={skuLoading}>
              {restockView.slice(0, 6).map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Tag color="orange">{r.store_code || r.mall_id}</Tag>{r.title || r.sku_ext_code || "—"}</span>
                  <span style={{ color: "#d46b08", whiteSpace: "nowrap" }}>{(r.stock || 0) <= 0 ? "已断货" : `可售${r.sale_days ?? "?"}天`}</span>
                </div>
              ))}
              {restockView.length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无需补货</div>}
            </Card>)}
            {!HIDE_STOCK && (<Card size="small" title="紧急备货在途" extra={<a onClick={() => setActiveTab("stock")}>全部</a>} loading={stockLoading}>
              {stockView.slice(0, 6).map((r) => (
                <div key={r.__rk} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Tag>{r.store_code || r.mall_id}</Tag>{r.product_name || r.sku_ext_code || "—"}</span>
                  <span style={{ color: "#cf1322", whiteSpace: "nowrap" }}>缺{r.gap}</span>
                </div>
              ))}
              {stockView.length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无备货缺口</div>}
            </Card>)}
          </div>
        </div>
      ),
    },
    {
      key: "pipeline", label: "商品全景",
      children: <PipelineTab reloadSignal={pipelineReloadSignal} isStoreInScope={isPipelineStoreInScope} onRiskTagClick={goPipelineRiskTag} />,
    },
    {
      key: "product", label: "商品",
      children: (
        <div>
          {!(HIDE_DIAG && HIDE_RESTOCK) && (
          <div style={{ padding: "12px 16px 0" }}>
            <Segmented value={prodSeg} onChange={(v) => setProdSeg(v as string)} options={[{ label: "运营全景", value: "panel" }, ...(HIDE_DIAG ? [] : [{ label: "诊断待办", value: "diag" }]), ...(HIDE_RESTOCK ? [] : [{ label: "补货清单", value: "restock" }])]} />
          </div>
          )}
          {(prodSeg === "panel" || (HIDE_DIAG && HIDE_RESTOCK)) ? (
            <div>
              <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>每个商品(SPU)横向集成:可报活动 / 合规状态 / 流量(曝光·点击·转化) / 高价限流。按 限流 &gt; 违规 &gt; 活动 排序;流量「无」表示该商品暂未采到(采集覆盖待提升)。总库存 = 可用 + 暂不可用 − 缺货件数 + 在途库存。滞销 = 加入站点&gt;20天 且 可售天数(可用库存÷近7日均销)&gt;20天。</div>
              {commonFilters(
                <>
                  <Select size="small" style={{ width: 150 }} value={slowFilter} onChange={setSlowFilter} options={[{ value: "all", label: "全部商品" }, { value: "slow", label: `仅看滞销 (${slowCount})` }]} />
                  <Select size="small" style={{ width: 160 }} value={onsaleDaysFilter} onChange={setOnsaleDaysFilter} options={[{ value: "all", label: "全部站点时间" }, { value: "0", label: "未上架" }, { value: "7", label: "≤7天" }, { value: "15", label: "≤15天" }, { value: "30", label: "≤30天" }, { value: "60", label: "≤60天" }]} />
                </>,
              )}
              <Table<ProductPanelRow> className="op-panel-table" dataSource={panelView} columns={panelColumns.filter((c) => { const k = String(c.key ?? ""); const di = String((c as { dataIndex?: string }).dataIndex ?? ""); if (HIDE_REVIEW && k === "score") return false; if (HIDE_ACTIVITY && k === "act") return false; if (OFFICIAL_SOURCE && (k === "declared_price" || ["limited", "compliance", "expose", "click", "pay", "conv"].includes(di))) return false; return true; })} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个商品` }} scroll={{ x: 1560, y: "calc(100vh - 320px)" }} loading={panelLoading} />
            </div>
          ) : prodSeg === "diag" ? (
            <div>
              <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
                <Statistic title="待诊断 SKU" value={overview.urgent + overview.warn + overview.note + overview.healthy} />
                <Statistic title="急" value={overview.urgent} valueStyle={{ color: overview.urgent > 0 ? "#cf1322" : undefined }} />
                <Statistic title="警" value={overview.warn} valueStyle={{ color: overview.warn > 0 ? "#d46b08" : undefined }} />
                <Statistic title="注意" value={overview.note} valueStyle={{ color: overview.note > 0 ? "#d4b106" : undefined }} />
                <Statistic title="健康" value={overview.healthy} valueStyle={{ color: "#3f8600" }} />
              </div>
              {commonFilters(
                <Select size="small" style={{ width: 140 }} value={diagFilter} onChange={setDiagFilter} options={[{ value: "all", label: "全部" }, { value: "issues", label: "仅有问题" }, { value: "urgent", label: "急" }, { value: "warn", label: "警" }, { value: "note", label: "注意" }, { value: "缺货号", label: "缺货号" }]} />,
              )}
              <Table<DiagnosedRow> dataSource={diagView} columns={diagColumnsStatic} rowKey={(r) => `${r.mall_id}|${r.skc_id}|${r.sku_ext_code}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1120 }} loading={skuLoading} />
            </div>
          ) : (
            <div>
              <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>需补货 SKU（已售罄 / 可售&lt;14天 / 有建议备货量），按紧急度排序。</div>
              {commonFilters()}
              <Table<SkuRow> dataSource={restockView} columns={restockColumnsStatic} rowKey={(r) => `${r.mall_id}|${r.skc_id}|${r.sku_ext_code}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1080 }} loading={skuLoading} />
            </div>
          )}
        </div>
      ),
    },
    {
      key: "qc", label: "平台质检",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>Temu 平台仓质检结果(官方采集),默认只列<b>不合格</b>:疵点原因 + 次品数 + 关联采购单,用于跟进补合规标签 / 改进生产。数据每 3 小时刷新。</div>
          {commonFilters()}
          <Table<QcRow> dataSource={qcView} columns={qcColumns} rowKey={(r) => `${r.mall_id}|${r.qc_bill_id}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条不合格` }} scroll={{ x: 1300 }} loading={qcLoading} />
        </div>
      ),
    },
    {
      key: "quality", label: "商品品质",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
            <Statistic title="商品数(当前筛选)" value={qualityDist.total} />
            <Statistic title="均分" value={qualityDist.avg != null ? qualityDist.avg.toFixed(1) : "—"} valueStyle={{ color: qualityDist.avg != null && qualityDist.avg < 75 ? "#d46b08" : "#3f8600" }} />
            <Statistic title={<span style={{ color: "#cf1322" }}>危险 &lt;60</span>} value={qualityDist.danger} valueStyle={{ color: qualityDist.danger > 0 ? "#cf1322" : undefined }} />
            <Statistic title={<span style={{ color: "#d46b08" }}>警告 60-74</span>} value={qualityDist.warn} valueStyle={{ color: qualityDist.warn > 0 ? "#d46b08" : undefined }} />
            <Statistic title={<span style={{ color: "#3f8600" }}>良好 75-89</span>} value={qualityDist.good} valueStyle={{ color: "#3f8600" }} />
            <Statistic title={<span style={{ color: "#1677ff" }}>优秀 ≥90</span>} value={qualityDist.excellent} valueStyle={{ color: "#1677ff" }} />
          </div>
          {qualityDist.hasScore > 0 && (
            <div style={{ padding: "8px 16px 0" }}>
              <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "#f0f0f0" }}>
                {qualityDist.danger > 0 && <div style={{ width: `${(qualityDist.danger / qualityDist.hasScore) * 100}%`, background: "#cf1322" }} />}
                {qualityDist.warn > 0 && <div style={{ width: `${(qualityDist.warn / qualityDist.hasScore) * 100}%`, background: "#faad14" }} />}
                {qualityDist.good > 0 && <div style={{ width: `${(qualityDist.good / qualityDist.hasScore) * 100}%`, background: "#52c41a" }} />}
                {qualityDist.excellent > 0 && <div style={{ width: `${(qualityDist.excellent / qualityDist.hasScore) * 100}%`, background: "#1677ff" }} />}
              </div>
            </div>
          )}
          <div style={{ padding: "8px 16px 0", color: "#888", fontSize: 12 }}>Temu 后台「商品品质看板」数据(扩展抓包):每个商品的<b>品质分</b>(0-100,越低越差) + 品质售后率 + 售后/差评问题分布,默认按品质分升序(最差排前)。⚠️被动抓包:仅覆盖在后台打开过品质看板的店,其余店暂无数据。</div>
          {qualityShopsView.length > 0 && (
            <div style={{ padding: "8px 16px 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {qualityShopsView.map((s) => (
                <Tooltip key={s.mall_id} title={`近90天 · 均分 ${s.avg_score_90d != null ? s.avg_score_90d.toFixed(2) : "—"}${s.expect_loss ? " · 预计损失 " + s.expect_loss : ""}`}>
                  <Tag color="blue">{formatStoreNo(s.store_code === s.mall_id ? null : s.store_code, s.mall_id)} 售后率 {s.afs_rate_90d != null ? (s.afs_rate_90d * 100).toFixed(2) + "%" : "—"}</Tag>
                </Tooltip>
              ))}
            </div>
          )}
          {commonFilters(
            <Select size="small" style={{ width: 110 }} value={qualitySiteFilter} onChange={setQualitySiteFilter} options={[{ value: "all", label: "全部站点" }, { value: "cn", label: "全球" }, { value: "us", label: "美区" }, { value: "eu", label: "欧区" }]} />,
          )}
          <Table<QualityRow> dataSource={qualityView} columns={qualityColumnsStatic} rowKey={(r) => `${r.mall_id}|${r.site}|${r.product_id || r.goods_id}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个商品` }} scroll={{ x: 1360 }} loading={qualityLoading} />
        </div>
      ),
    },
    {
      key: "hpf", label: "高价限流",
      children: (
        <div>
          <div style={{ padding: "16px 16px 8px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {([
              { label: "被限流商品", value: hpfAgg.total, bg: "#fff1f0", border: "#ffccc7", color: hpfAgg.total > 0 ? "#cf1322" : "#595959" },
              { label: "平均流量降幅", value: hpfAgg.avg != null ? `${hpfAgg.avg}%` : "—", bg: "#fff7e6", border: "#ffe7ba", color: "#d46b08" },
              { label: "重度限流(降幅≥50%)", value: hpfAgg.severe, bg: hpfAgg.severe > 0 ? "#fff1f0" : "#fafafa", border: hpfAgg.severe > 0 ? "#ffa39e" : "#d9d9d9", color: hpfAgg.severe > 0 ? "#a8071a" : "#595959" },
              { label: "涉及店铺", value: hpfAgg.shops, bg: "#e6f7ff", border: "#91d5ff", color: "#096dd9" },
            ] as const).map((c, i) => (
              <div key={i} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: "14px 18px" }}>
                <div style={{ fontSize: 12, color: "#595959", marginBottom: 2 }}>{c.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: c.color, lineHeight: 1.2 }}>{c.value}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "0 16px 4px" }}>
            <Alert type="info" showIcon message="数据来自扩展抓包采集(近14天),按流量下降率降序。有目标价数据时显示建议调价。" banner style={{ fontSize: 12, borderRadius: 6 }} />
          </div>
          {commonFilters(
            <Segmented size="small" value={hpfStatusFilter} onChange={(v) => setHpfStatusFilter(String(v))} options={[
              { label: `全部 (${hpfAgg.limited + hpfAgg.pending})`, value: "all" },
              { label: `已限流 (${hpfAgg.limited})`, value: "1" },
              { label: `即将限流 (${hpfAgg.pending})`, value: "2" },
            ]} />,
          )}
          <Table<HpfRow> dataSource={hpfView} columns={hpfColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个商品` }} scroll={{ x: 1140 }} loading={hpfLoading} onRow={(r) => ({ style: { ...(r.decline_rate != null && r.decline_rate >= 50 ? { background: "#fff8f8" } : {}), cursor: "pointer" }, onClick: () => openHpfDetail(r.mall_id, String(r.product_id)) })} />
        </div>
      ),
    },
    {
      key: "review", label: "评价",
      children: <ReviewTab active={activeTab === "review"} storeFilter={storeFilter} search={search} commonFilters={commonFilters} />,
    },
    {
      key: "stock", label: "备货在途",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>未完成的备货 / 发货单(需求量 &gt; 已发量),按最晚发货时间升序(越紧急越靠前);缺口 = 需求 − 已发。</div>
          {commonFilters()}
          <Table<StockOrderRow> dataSource={stockView} columns={stockColumnsStatic} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1050 }} loading={stockLoading} />
        </div>
      ),
    },
    {
      key: "risk", label: "风险待办",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            <Statistic title="风险总数" value={riskRows.length} />
            <Statistic title="高" value={riskOverview.high} valueStyle={{ color: riskOverview.high > 0 ? "#cf1322" : undefined }} />
            <Statistic title="中" value={riskOverview.medium} valueStyle={{ color: riskOverview.medium > 0 ? "#d46b08" : undefined }} />
            <Statistic title="低" value={riskOverview.low} valueStyle={{ color: "#d4b106" }} />
          </div>
          {commonFilters(
            <Select size="small" style={{ width: 110 }} value={sevFilter} onChange={setSevFilter} options={[{ value: "all", label: "全部严重度" }, { value: "high", label: "高" }, { value: "medium", label: "中" }, { value: "low", label: "低" }]} />,
          )}
          <Table<RiskRow> dataSource={riskView} columns={riskColumnsStatic} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 880 }} loading={riskLoading} />
        </div>
      ),
    },
    {
      key: "activity", label: "活动",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Segmented size="small" value={actStatusFilter} onChange={(v) => setActStatusFilter(String(v))}
              options={[
                { label: `全部 (${actStatusCounts["全部"] || 0})`, value: "全部" },
                ...["进行中", "未开始"].filter(s => actStatusCounts[s]).map(s => ({ label: `${s} (${actStatusCounts[s]})`, value: s })),
              ]}
            />
          </div>
          {commonFilters()}
          {actLoading ? <div style={{ textAlign: "center", padding: 60 }}><Spin /></div> : (
            actProductView.length === 0 ? <Empty description="暂无活动数据" style={{ padding: 40 }} /> : (
              <Table dataSource={actProductView} rowKey="key" size="small"
                pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个商品` }}
                scroll={{ x: 1100 }}
                columns={[
                  { title: "店铺", key: "store", width: 78, fixed: "left" as const, render: (_, r) => formatStoreNo(r.store_code, r.mall_id) },
                  { title: "商品", key: "prod", width: 280, fixed: "left" as const, render: (_, r) => (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {r.thumb ? <Image src={r.thumb} width={48} height={48} style={{ objectFit: "cover", borderRadius: 4 }} preview={{ mask: <EyeOutlined /> }} /> : <div style={{ width: 48, height: 48, background: "#f0f0f0", borderRadius: 4, flexShrink: 0 }} />}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, color: "#555", lineHeight: "18px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.product_name || "—"}</div>
                        <Typography.Text copyable={{ text: r.sku_ext_code || "" }} style={{ fontSize: 13, fontWeight: 600 }}>{r.sku_ext_code || "—"}</Typography.Text>
                      </div>
                    </div>
                  ) },
                  { title: "活动数", key: "actCount", width: 80, align: "center" as const, sorter: (a, b) => a._actTotal - b._actTotal, render: (_, r) => <span style={{ fontWeight: 600 }}>{r._actTotal}</span> },
                  { title: "进行中", key: "inProg", width: 80, align: "center" as const, sorter: (a, b) => a._actInProgress - b._actInProgress, render: (_, r) => r._actInProgress > 0 ? <Tag color="green" style={{ margin: 0 }}>{r._actInProgress}</Tag> : <span style={{ color: "#bbb" }}>0</span> },
                  { title: "未开始", key: "pending", width: 80, align: "center" as const, sorter: (a, b) => a._actPending - b._actPending, render: (_, r) => r._actPending > 0 ? <Tag color="orange" style={{ margin: 0 }}>{r._actPending}</Tag> : <span style={{ color: "#bbb" }}>0</span> },
                  { title: "最佳利润", key: "margin", width: 100, align: "right" as const, sorter: (a, b) => (a.best_profit ?? -Infinity) - (b.best_profit ?? -Infinity), render: (_, r) => {
                    if (r.best_profit == null) return <span style={{ color: "#bbb" }}>—</span>;
                    return <span style={{ color: r.best_profit > 0 ? "#3f8600" : r.best_profit < 0 ? "#cf1322" : undefined, fontWeight: 600 }}>¥{r.best_profit.toFixed(2)}</span>;
                  } },
                  { title: "类型", key: "kinds", width: 120, render: (_, r) => r.kinds.length ? r.kinds.map(k => {
                    const label = KIND_LABEL[k] || k;
                    return <Tag key={k} color={k === "bidding" ? "purple" : k === "coupon" ? "cyan" : "blue"} style={{ margin: "0 4px 0 0" }}>{label}</Tag>;
                  }) : <span style={{ color: "#bbb" }}>—</span> },
                  { title: "操作", key: "op", width: 100, fixed: "right" as const, render: (_, r) => <Button size="small" type="link" onClick={() => { setEnrollProdKey(r.key); setSelActRows([]); setModalStatusFilter("进行中"); }}>查看活动</Button> },
                ]}
              />
            )
          )}
        </div>
      ),
    },
    {
      key: "site_exception", label: "站点异常",
      children: <SiteExceptionTab active={activeTab === "site_exception"} storeFilter={storeFilter} search={search} commonFilters={commonFilters} />,
    },
    {
      key: "flux", label: "流量",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>商品级流量明细(扩展主动采集)：曝光 → 点击 → 详情访客 → 加购 → 支付买家，完整转化漏斗。点击商品名查看趋势。数据来源: /api/seller/full/flow/analysis/goods/list。</div>
          {commonFilters(
            <>
              <Select size="small" style={{ width: 110 }} value={flowSiteFilter} onChange={setFlowSiteFilter} options={[{ value: "all", label: "全部区域" }, { value: "agentseller", label: "全球" }, { value: "agentseller-us", label: "美区" }, { value: "agentseller-eu", label: "欧区" }]} />
              <Select size="small" style={{ width: 130 }} value={flowDateFilter || (flowDates[0] || "")} onChange={setFlowDateFilter}
                options={flowDates.map((d) => ({ value: d, label: d }))} />
            </>,
          )}
          <Table<FlowAnalysisRow> dataSource={flowView} columns={flowColumns} rowKey="__rk" size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1500, y: "calc(100vh - 320px)" }} loading={flowLoading} />
          <Modal title={flowTrendOf ? <Tooltip title={flowTrendOf.title}><span style={{ maxWidth: 500, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>流量趋势 · {flowTrendOf.title}</span></Tooltip> : "流量趋势"} open={!!flowTrendOf} onCancel={() => setFlowTrendOf(null)} footer={null} width={900}>
            {flowTrendLoading ? <Spin /> : flowTrendRows.length === 0 ? <Empty description="暂无趋势数据" /> : (() => {
              const REGIONS = [
                { key: "全球", color: "#1a73e8" },
                { key: "美区", color: "#ea4335" },
                { key: "欧区", color: "#34a853" },
              ];
              const hasRegion = (suffix: string) => flowTrendRows.some(r => r[`expose_${suffix}`] != null);
              const active = REGIONS.filter(r => hasRegion(r.key));
              const chartProps = { margin: { top: 8, right: 12, bottom: 0, left: -4 } };
              const xProps = { dataKey: "date" as const, tick: { fontSize: 10 }, minTickGap: 20 };
              const gridProps = { strokeDasharray: "3 3", stroke: "#f0f0f0", vertical: false };
              const tipStyle = { contentStyle: { borderRadius: 8, border: "none", boxShadow: "0 2px 12px rgba(0,0,0,.12)", fontSize: 12 } };
              return (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: "#333" }}>曝光</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={flowTrendRows} {...chartProps}>
                      <defs>
                        {active.map(r => (
                          <linearGradient key={r.key} id={`grad_expose_${r.key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={r.color} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={r.color} stopOpacity={0.02} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis {...xProps} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} tickFormatter={(v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toLocaleString()} />
                      <RTooltip {...tipStyle} formatter={(v: number, name: string) => [v?.toLocaleString(), name.replace("expose_", "")]} labelFormatter={(l: string) => l} />
                      <Legend iconType="circle" iconSize={8} formatter={(v: string) => v.replace("expose_", "")} />
                      {active.map(r => (
                        <Area key={r.key} type="monotone" dataKey={`expose_${r.key}`} name={`expose_${r.key}`} stroke={r.color} strokeWidth={2} fill={`url(#grad_expose_${r.key})`} dot={{ r: 2.5, fill: r.color, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                  <div style={{ fontWeight: 600, fontSize: 13, marginTop: 16, marginBottom: 6, color: "#333" }}>点击率 (%)</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={flowTrendRows} {...chartProps}>
                      <CartesianGrid {...gridProps} />
                      <XAxis {...xProps} />
                      <YAxis tick={{ fontSize: 10 }} unit="%" />
                      <RTooltip {...tipStyle} formatter={(v: number, name: string) => [`${v}%`, name.replace("ctr_", "")]} labelFormatter={(l: string) => l} />
                      <Legend iconType="circle" iconSize={8} formatter={(v: string) => v.replace("ctr_", "")} />
                      {active.map(r => (
                        <Line key={r.key} type="monotone" dataKey={`ctr_${r.key}`} name={`ctr_${r.key}`} stroke={r.color} strokeWidth={2} dot={{ r: 3, fill: "#fff", stroke: r.color, strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  <div style={{ fontWeight: 600, fontSize: 13, marginTop: 16, marginBottom: 6, color: "#333" }}>点击支付率 (%)</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={flowTrendRows} {...chartProps}>
                      <CartesianGrid {...gridProps} />
                      <XAxis {...xProps} />
                      <YAxis tick={{ fontSize: 10 }} unit="%" />
                      <RTooltip {...tipStyle} formatter={(v: number, name: string) => [`${v}%`, name.replace("cvr_", "")]} labelFormatter={(l: string) => l} />
                      <Legend iconType="circle" iconSize={8} formatter={(v: string) => v.replace("cvr_", "")} />
                      {active.map(r => (
                        <Line key={r.key} type="monotone" dataKey={`cvr_${r.key}`} name={`cvr_${r.key}`} stroke={r.color} strokeWidth={2} dot={{ r: 3, fill: "#fff", stroke: r.color, strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}
          </Modal>
        </div>
      ),
    },
  ], [
    // 总览 Tab
    shopAgg, storeMatrix, overviewTrend, riskOverview, overview, restockView, stockView, stockLoaded, actProductView,
    shopLoading, riskLoading, skuLoading, lifecycleLoading, stockLoading, trendLoading,
    setActiveTab, goProduct, navigate, riskView,
    // 商品全景 Tab
    pipelineReloadSignal, isPipelineStoreInScope, goPipelineRiskTag,
    commonFilters,
    // 商品 Tab
    prodSeg, setProdSeg, panelView, panelColumns, panelLoading, slowFilter, setSlowFilter, slowCount, onsaleDaysFilter, setOnsaleDaysFilter,
    diagView, diagFilter, setDiagFilter,
    // 平台质检 Tab
    qcView, qcColumns, qcLoading,
    // 商品品质 Tab
    qualityView, qualityDist, qualityShopsView, qualitySiteFilter, setQualitySiteFilter, qualityLoading,
    // 高价限流 Tab
    hpfView, hpfColumns, hpfAgg, hpfLoading,
    // 风险待办 Tab
    sevFilter, setSevFilter,
    // 活动报名 Tab
    actProductView, actStatusCounts, actStatusFilter, actLoading, setEnrollProdKey, setSelActRows, setModalStatusFilter,
    // 流量 Tab
    flowView, flowColumns, flowLoading, flowSiteFilter, setFlowSiteFilter,
    flowDateFilter, setFlowDateFilter, flowDates,
    flowTrendOf, flowTrendRows, flowTrendLoading, setFlowTrendOf,
    // 公共筛选
    storeFilter, storeOptions, searchInput,
  ]);

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="运营工作台"
        extra={<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>我的店</Typography.Text>
          <Select size="small" style={{ width: 140 }} value={ownerFilter} onChange={setOwner} options={[{ value: "all", label: "全部负责人" }, ...ownerOptions.map((o) => ({ value: o, label: o }))]} disabled={ownerOptions.length === 0} placeholder="负责人" />
          <Button icon={<ReloadOutlined />} loading={skuLoading || riskLoading || actLoading || shopLoading || trendLoading || stockLoading || panelLoading} onClick={() => { reloadAllOpsReports(); if (activeTab === "pipeline") setPipelineReloadSignal((n) => n + 1); message.success("已刷新"); }}>刷新</Button>
        </div>}
        bodyStyle={{ padding: 0 }}
      >
        {error && <Alert type="error" showIcon message="加载失败" description={error} style={{ margin: 16 }} action={<Button size="small" onClick={loadSku}>重试</Button>} />}
        <Tabs activeKey={activeTab} onChange={setActiveTab} destroyInactiveTabPane items={tabItems.filter((t) => !(HIDE_RISK && t.key === "risk") && !(HIDE_ACTIVITY && t.key === "activity") && !(HIDE_STOCK && t.key === "stock"))} tabBarStyle={{ paddingLeft: 16, marginBottom: 0 }} />
      </Card>
      <div style={{ display: "none" }}>
        <Image.PreviewGroup items={flawPreviewImages} preview={{ visible: flawPreviewVisible, onVisibleChange: (v) => setFlawPreviewVisible(v) }} />
      </div>
      <Modal open={!!enrollProdKey} onCancel={() => { setEnrollProdKey(null); setSelActRows([]); }} width="92vw" destroyOnClose
        title={null} closable={false} footer={null} centered
        styles={{ body: { padding: "0 24px 16px", maxHeight: "70vh", overflowY: "auto" }, header: { padding: "12px 24px 0", borderBottom: "none" } }}>
        {enrollProduct && (
          <div>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "16px 0 12px", borderBottom: "1px solid #f0f0f0", marginBottom: 16 }}>
              {enrollProduct.thumb && <img src={enrollProduct.thumb} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #eee", flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#262626", lineHeight: 1.5, wordBreak: "break-word" }}>活动详情 · {enrollProduct.product_name || "—"}</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>货号: {enrollProduct.sku_ext_code || "—"}</div>
              </div>
              <Button type="primary" danger size="small" onClick={() => { setEnrollProdKey(null); setSelActRows([]); }} style={{ flexShrink: 0 }}>关闭</Button>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 16 }}>
              {["全部", "进行中", "未开始"].map(s => (
                <Button key={s} size="small" type={modalStatusFilter === s ? "primary" : "default"}
                  onClick={() => setModalStatusFilter(s)}>{s} ({modalStatusCounts[s] || 0})</Button>
              ))}
            </div>
            <Table dataSource={modalFiltered} rowKey={r => String(r.__rk)} size="small"
              pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50], showTotal: (t, range) => `共有 ${t} 条  每页 ${range[1] - range[0] + 1} 条` }}
              scroll={{ x: 1100 }} locale={{ emptyText: "暂无可显示的筛信息" }}
              columns={[
                { title: "SKU属性集", key: "spec", width: 110, render: (_, r) => r.color_spec || <span style={{ color: "#bbb" }}>—</span> },
                { title: "日常申报价", dataIndex: "suggested_price", width: 100, align: "right", render: (v) => v != null ? <span>¥{v.toFixed(2)}</span> : <span style={{ color: "#bbb" }}>—</span> },
                { title: "活动申报价", dataIndex: "signup_price", width: 100, align: "right", render: (v) => v != null ? <span>¥{v.toFixed(2)}</span> : <span style={{ color: "#bbb" }}>—</span> },
                { title: "报名时间", key: "enroll_at", width: 150, render: (_, r) => r.enroll_at || <span style={{ color: "#bbb" }}>—</span> },
                { title: "活动类型", key: "title", width: 280, ellipsis: true, render: (_, r) => {
                  return <span>{r.title || <span style={{ color: "#bbb" }}>(未命名)</span>}</span>;
                } },
                { title: "报名场次", key: "sites", width: 280, render: (_, r) => {
                  const s = r.sites || [];
                  const startD = r.start_at?.slice(0, 10) || "";
                  const endD = r.end_at?.slice(0, 10) || "";
                  const dateRange = startD && endD ? `${startD}~${endD}` : startD || endD || "";
                  const statusText = r.status === "进行中" ? ",进行中" : r.status === "未开始" ? ",报名成功待开始" : r.status ? `,${r.status}` : "";
                  if (!s.length) {
                    if (!dateRange) return <span style={{ color: "#bbb" }}>—</span>;
                    return <div style={{ fontSize: 12, lineHeight: "18px" }}>{dateRange}{statusText}</div>;
                  }
                  const fmt = (name: string) => `${name}-${dateRange}${statusText}`;
                  const show = s.slice(0, 3);
                  const rest = s.length - 3;
                  return (<div style={{ fontSize: 12, lineHeight: "18px" }}>
                    {show.map((n, i) => <div key={i}>{fmt(n)}</div>)}
                    {rest > 0 && <Popover trigger="click" title={`全部场次 (${s.length})`} content={<div style={{ maxHeight: 300, overflow: "auto", fontSize: 12, lineHeight: "22px" }}>{s.map((n, i) => <div key={i}>{fmt(n)}</div>)}</div>}><a style={{ fontSize: 12, color: "#1677ff" }}>更多</a></Popover>}
                  </div>);
                } },
                { title: "提报数量", dataIndex: "activity_stock", width: 90, align: "right", render: (v: number) => v > 0 ? fmtNum(v) : <span style={{ color: "#bbb" }}>0</span> },
                { title: "剩余数量", key: "remain", width: 90, align: "right", render: (_, r) => { const v = (r as any).remaining_stock ?? r.activity_stock; return v > 0 ? fmtNum(v) : <span style={{ color: "#bbb" }}>0</span>; } },
                { title: "活动状态", key: "status", width: 80, render: (_, r) => {
                  const s = r.status; if (!s) return <span style={{ color: "#bbb" }}>—</span>;
                  return <Tag color={s === "进行中" ? "green" : s === "已报名" ? "blue" : s === "未开始" ? "orange" : "default"} style={{ margin: 0 }}>{s}</Tag>;
                } },
              ]}
            />
          </div>
        )}
      </Modal>
      <Modal open={!!trendOf} onCancel={() => setTrendOf(null)} footer={null} width={680} title={trendOf ? `销量趋势 · ${trendOf.title}` : ""} destroyOnClose>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>逐日销量(抓包采集,覆盖近 2 周、部分店);SPU {trendOf?.productId}</div>
        {trendModalLoading ? <div style={{ textAlign: "center", padding: 80, color: "#999" }}>加载中…</div>
          : trendModalRows.length === 0 ? <Empty description="该商品暂无逐日数据(采集可能未覆盖其店铺)" style={{ padding: 40 }} />
          : <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendModalRows} margin={{ top: 10, right: 20, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={16} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip />
                <Line type="monotone" dataKey="qty" name="销量" stroke="#1a73e8" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>}
      </Modal>
      <Modal open={hpfDetailOpen} onCancel={() => setHpfDetailOpen(false)} footer={null} width={820} destroyOnClose
        title={null} closable styles={{ body: { padding: "28px 32px" } }}>
        {hpfDetailLoading ? <div style={{ textAlign: "center", padding: 80, color: "#999" }}>加载中…</div>
          : !hpfDetail ? <Empty description="未找到限流详情数据" style={{ padding: 40 }} />
          : <div>
              <div style={{ display: "flex", gap: 18, marginBottom: 20 }}>
                {hpfDetail.image ? <img src={hpfDetail.image} alt="" style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 6, border: "1px solid #eee", flexShrink: 0 }} /> : null}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, wordBreak: "break-word", color: "#262626" }}>{hpfDetail.product_name || "—"}</div>
                  <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
                    {hpfDetail.skc_id ? <span>SKC: {hpfDetail.skc_id}</span> : null}
                  </div>
                  <div style={{ fontSize: 14, color: "#262626", marginTop: 6, fontWeight: 500 }}>共 {hpfDetail.site_count} 个限流站点：</div>
                </div>
              </div>
              <div style={{ marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {hpfDetail.sites.slice(0, 6).map((s) => <span key={s.id} style={{ padding: "4px 14px", border: "1px solid #d9d9d9", borderRadius: 4, fontSize: 13, color: "#262626", background: "#fff" }}>{s.name}</span>)}
                {hpfDetail.sites.length > 6 ? <Popover trigger="click" placement="bottomRight" content={<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, width: 280, maxHeight: 280, overflowY: "auto" }}>{hpfDetail.sites.map((s) => <div key={s.id} style={{ padding: "6px 12px", fontSize: 13, color: "#262626", borderBottom: "1px solid #f0f0f0" }}>{s.name}</div>)}</div>}><span style={{ padding: "4px 14px", border: "1px solid #1677ff", borderRadius: 4, fontSize: 13, color: "#1677ff", background: "#f0f5ff", cursor: "pointer" }}>更多</span></Popover> : null}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "3px solid #1677ff" }}>
                    {["规格", "原价(CNY)", "解除限流价(CNY)", "折扣(折)", "低价竞品", "详细限流站点"].map((h, i) => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: i === 0 ? "left" : "center", fontWeight: 600, color: "#262626", fontSize: 13 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hpfDetail.skus.map((sku, i) => (
                    <tr key={sku.sku_id} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fafbff" : "#fff" }}>
                      <td style={{ padding: "12px", color: "#262626" }}>{sku.spec || "—"}</td>
                      <td style={{ padding: "12px", textAlign: "center", color: "#262626" }}>{sku.current_price > 0 ? sku.current_price.toFixed(2) : "—"}</td>
                      <td style={{ padding: "12px", textAlign: "center", color: "#cf1322", fontWeight: 600 }}>{sku.target_price > 0 ? sku.target_price.toFixed(2) : "—"}</td>
                      <td style={{ padding: "12px", textAlign: "center", color: "#cf1322" }}>{sku.discount != null ? `${sku.discount.toFixed(2)}折` : "—"}</td>
                      <td style={{ padding: "12px", textAlign: "center" }}>{sku.has_competitor ? <Tooltip title={sku.competitor_name}><a style={{ color: "#1677ff" }}>查看</a></Tooltip> : <span style={{ color: "#bbb" }}>无</span>}</td>
                      <td style={{ padding: "12px", textAlign: "center" }}><a onClick={() => setHpfSiteDetailOpen(true)} style={{ color: "#1677ff", cursor: "pointer" }}>查看</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hpfDetail.min_target_price != null && hpfDetail.max_discount != null ? (
                <div style={{ marginTop: 24, fontSize: 15, textAlign: "center", lineHeight: 2 }}>
                  <span style={{ color: "#d4380d", fontWeight: 700 }}>提示：</span>
                  <span style={{ color: "#262626" }}> 报名 </span>
                  <span style={{ border: "2px solid #cf1322", borderRadius: 4, padding: "2px 10px", color: "#cf1322", fontWeight: 700 }}>{hpfDetail.max_discount.toFixed(2)}折</span>
                  <span style={{ color: "#262626" }}> 活动 或设置活动价为：</span>
                  <span style={{ border: "2px solid #595959", borderRadius: 4, padding: "2px 10px", color: "#262626", fontWeight: 700 }}>{hpfDetail.min_target_price.toFixed(2)}</span>
                  <span style={{ color: "#262626" }}> 即可解除商品限流</span>
                </div>
              ) : null}
            </div>}
      </Modal>
      <Modal open={hpfSiteDetailOpen} onCancel={() => setHpfSiteDetailOpen(false)} footer={null} width={480} destroyOnClose
        title={<span style={{ fontSize: 16, fontWeight: 600 }}>限流站点建议申报价</span>} centered>
        {hpfDetail && hpfDetail.sites.length > 0 ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 12px", fontSize: 13, color: "#888" }}>
              <span>当前限流站点（{hpfDetail.sites.length}）</span>
              <span>建议申报价（CNY）</span>
            </div>
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {hpfDetail.sites.map((s) => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f0f0f0", fontSize: 14 }}>
                  <span style={{ color: "#262626" }}>{s.name}</span>
                  <span style={{ color: "#cf1322", fontWeight: 600, fontSize: 15 }}>{s.target_price != null ? s.target_price.toFixed(2) : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        ) : <Empty description="暂无站点数据" style={{ padding: 32 }} />}
      </Modal>
    </div>
  );
}
