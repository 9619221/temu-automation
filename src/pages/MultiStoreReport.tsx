import { useCallback, useEffect, useMemo, useState } from "react";
import PurchaseReportPanel from "./PurchaseReport";
import { formatStoreNo, formatMallName } from "../utils/storeDisplay";
import {
  Alert,
  AutoComplete,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, CloudDownloadOutlined, DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { readPageCache, writePageCache } from "../utils/pageCache";
import { useSessionState } from "../hooks/useSessionState";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

interface FinWindow {
  revenue: number;
  cost: number;
  gross_profit: number;
  qty: number;
}
interface StoreFinancials {
  latest_date: string | null;
  today: FinWindow;
  last7d: FinWindow & { revenue_prev: number; rev_wow: number | null };
  last30d: FinWindow & { revenue_prev: number; rev_mom: number | null };
  cost_coverage: number | null;
  trend_daily: Array<{ date: string; revenue: number; gross_profit: number }>;
}

interface StoreSettlement {
  latest_date: string | null;
  today: { income: number };
  last7d: { income: number; income_prev: number; income_wow: number | null };
  last30d: { income: number; income_prev: number; income_mom: number | null };
  trend_daily: Array<{ date: string; income: number }>;
}

interface SettlementDetailBucket {
  count: number;
  estimated: number;
  sales_receipt: number;
  chargeback: number;
  subsidy: number;
  total: number;
}
interface StoreSettlementDetail {
  currency: string;
  wait_settlement: SettlementDetailBucket;
  in_settlement: SettlementDetailBucket;
  settled: SettlementDetailBucket;
}

interface FundDetailData {
  in_total: number;
  out_total: number;
  by_category: Record<string, number>;
}

interface FundSummaryData {
  latest_date: string | null;
  currency: string;
  income_total: number;
  expense_total: number;
  balance_amount: number;
  frozen_amount: number;
  available_amount: number;
  total_amount: number;
  rows: number;
  day_rows: number;
  month_rows: number;
}

interface SettlementRiskData {
  violation_count: number;
  inbound_exception_count: number;
  high_count: number;
  latest_date: string | null;
  by_type: Record<string, number>;
}

// EPR 费用（erp_temu_epr_fee 物化，机器人主动采 eprfee 接口）
interface EprDetailData {
  wait_amount: number;
  deducted_amount: number;
  wait_count: number;
  deducted_count: number;
  total_count: number;
}

// 资金限制（erp_temu_fund_frozen 物化，fund-frozen/rules 快照）
interface FundFrozenItem {
  frozen_type: string;
  reason: string | null;
  amount: number;
  currency: string | null;
  unfreeze_condition: string | null;
}
interface FundFrozenData {
  total_amount: number;
  items: FundFrozenItem[];
}

// 违规处罚明细（erp_temu_violation 物化，tmod_punish entrance/list 直解）
interface ViolationItem {
  target_id: string;
  goods_id: string | null;
  goods_name: string | null;
  source_punish_name: string | null;
  leaf_reason_name: string | null;
  violation_desc: string | null;
  punish_status_desc: string | null;
  appeal_status: number | null;
  can_appeal: number | null;
  can_rectify: number | null;
  site_num: number | null;
  punish_num: number | null;
  stat_date: string | null;
}
interface ViolationData {
  violation_count: number;
  add_site_limit_status: number | null;
  release_limit_time: string | null;
  items: ViolationItem[];
}

// 账户概览（erp_temu_account_overview 物化，payment/account/amount/info 快照）
interface AccountOverviewData {
  available_amount: number;
  in_transit_amount: number;
  pending_settle_amount: number;
  frozen_amount: number;
  withdrawable_amount: number;
  total_amount: number;
  currency: string;
}

// 履约费用流出（erp_temu_fulfillment_bill 物化，warehouse/express/bill overview+detail）
interface FulfillmentBillItem {
  bill_type: string | null;
  amount: number;
  currency: string | null;
  waybill_no: string | null;
  stat_date: string | null;
}
interface FulfillmentBillData {
  overview_amount: number;
  detail_total: number;
  detail_count: number;
  currency: string;
  items: FulfillmentBillItem[];
}

interface ReportStore {
  mall_id: string;
  mall_name: string | null;
  site: string | null;
  mall_last_seen: string | null;
  store_code: string | null;
  store_status: string;
  dict_remark: string | null;
  owner: string | null;
  financials: StoreFinancials | null;
  settlement: StoreSettlement | null;
  settlement_detail: StoreSettlementDetail | null;
  fund_detail: FundDetailData | null;
  fund_summary: FundSummaryData | null;
  risk_detail: SettlementRiskData | null;
  sales: { today_qty: number; last7d_qty: number; last30d_qty: number; sku_count: number };
  stock_orders: { total: number; pending: number; demand_qty: number; delivered_qty: number };
  inventory?: { warehouse_value: number; in_transit_value: number };
  activities: { count: number; unique: number; skc_count: number };
  shop_stats: {
    stat_date: string | null;
    sale_volume: number;
    sale_7d: number;
    sale_30d: number;
    on_sale_skc: number;
    wait_skc: number;
    lack_skc: number;
    advice_prepare_skc: number;
    about_to_sell_out_skc: number;
    already_sold_out_skc: number;
    high_price_limit_skc: number;
    after_sale_ratio_90d: string | number | null;
    last_updated_at: string | null;
  };
  after_sales: { count: number };
  health: { last_capture_at: number | null; captures_total: number; lag_seconds: number | null };
}

interface ReportData {
  generated_at: number;
  cloud_tenant_id: string | null;
  store_count: number;
  financials_available: boolean;
  settlement_available: boolean;
  settlement_detail_available: boolean;
  fund_detail_available: boolean;
  fund_summary_available: boolean;
  risk_detail_available: boolean;
  sales_window: { start: string | null; end: string | null; days: number } | null;
  stores: ReportStore[];
  unmapped: ReportStore[];
}

interface MultiStoreResponse {
  ok: boolean;
  error?: string;
  data?: ReportData;
}

interface SkuRow {
  mall_id: string;
  store_code: string | null;
  mall_name: string | null;
  skc_id: string | null;
  sku_ext_code: string | null;
  product_id: string | null;
  title: string | null;
  category: string | null;
  today: number;
  last7d: number;
  last30d: number;
  stock: number;
  occupy: number;
  advice_qty: number;
  sale_days: number | null;
  declared_price: number | null;
  stat_date: string | null;
}

interface ShopHealthRow {
  mall_id: string;
  store_code: string | null;
  mall_name: string | null;
  owner: string | null;
  sale_volume: number;
  sale_7d: number;
  sale_30d: number;
  on_sale: number;
  wait_online: number;
  lack_skc: number;
  advice_prepare_skc: number;
  about_to_sell_out: number;
  already_sold_out: number;
  high_price_limit: number;
  after_sale_ratio_90d: number | null;
  stat_date: string | null;
}

interface StoreSalesView {
  today: number;
  last7d: number;
  last30d: number;
  stat_date: string | null;
  source: "shopHealth" | "shopStats" | "sales";
}

const REFRESH_MS = 5 * 60 * 1000; // 5 分钟自动刷新一次
const MULTI_STORE_REPORT_CACHE_KEY = "temu.multi-store-report.cache.v1";
const STALE_THRESHOLD_SECONDS = 2 * 60 * 60; // 2 小时无数据视为掉线
const UNASSIGNED = "__unassigned__";

// 预警阈值
const ALERT_MARGIN_LOW = 0.1; // 毛利率低于 10% 预警
const ALERT_AFTER_SALE_RATIO = 3; // 90 天售后率高于 3% 预警

function fmtNum(n: number | null | undefined) {
  if (n == null) return "-";
  return n.toLocaleString("zh-CN");
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return "¥" + Math.round(n).toLocaleString("zh-CN");
}

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(digits) + "%";
}

function marginOf(w: FinWindow | null | undefined): number | null {
  if (!w || w.revenue <= 0) return null;
  return w.gross_profit / w.revenue;
}

function parseAfterSaleRatio(v: string | number | null): number | null {
  if (v == null || v === "") return null;
  const num = typeof v === "number" ? v : Number(String(v).replace("%", ""));
  return Number.isFinite(num) ? num : null;
}

function fmtLag(seconds: number | null) {
  if (seconds == null) return "未上传";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function lagColor(seconds: number | null): string {
  if (seconds == null) return "default";
  if (seconds < 600) return "success";
  if (seconds < STALE_THRESHOLD_SECONDS) return "processing";
  return "error";
}

function DeltaTag({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: "#bbb" }}>—</span>;
  if (Math.abs(value) < 0.0005) return <span style={{ color: "#999" }}>0%</span>;
  const up = value > 0;
  return (
    <span style={{ color: up ? "#3f8600" : "#cf1322", fontSize: 12 }}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {(Math.abs(value) * 100).toFixed(1)}%
    </span>
  );
}

// 仅渲染店号（+负责人标签）；店铺名拆为独立列
function StoreCell({ store }: { store: ReportStore }) {
  return (
    <span>
      <Typography.Text strong>{formatStoreNo(store.store_code, store.mall_id)}</Typography.Text>
      {store.owner && (
        <Tag color="blue" style={{ marginLeft: 6 }}>{store.owner}</Tag>
      )}
    </span>
  );
}

function storeNameCell(store: ReportStore) {
  return <span style={{ color: "#555" }}>{formatMallName(store.mall_name, "(未命名)")}</span>;
}
const storeNameSorter = (a: ReportStore, b: ReportStore) => (a.mall_name || "").localeCompare(b.mall_name || "");

// SKU 售卖状态：售罄 / 建议补货 / 在售
function skuStatus(r: SkuRow): { text: string; color: string } {
  if (r.stock <= 0) return { text: "已售罄", color: "red" };
  if (r.advice_qty > 0) return { text: "建议补货", color: "orange" };
  return { text: "在售", color: "green" };
}

// 全局色彩语言：绿=健康、黄/橙=注意、红=异常
const COLOR = { good: "#3f8600", warn: "#d46b08", bad: "#cf1322", muted: "#bbb" };

function marginColor(m: number | null): string | undefined {
  if (m == null) return undefined;
  if (m < ALERT_MARGIN_LOW) return COLOR.bad;
  if (m < 0.3) return COLOR.warn;
  return COLOR.good;
}

// 数字 + 热力背景（值越大背景越深），0 显示灰 —
function HeatNum({ value, max, hue }: { value: number; max: number; hue: "red" | "orange" | "gold" }) {
  if (!value || value <= 0) return <span style={{ color: COLOR.muted }}>—</span>;
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const rgb = hue === "red" ? "255,77,79" : hue === "orange" ? "250,140,22" : "250,219,20";
  return (
    <span style={{ backgroundColor: `rgba(${rgb},${0.1 + ratio * 0.38})`, borderRadius: 4, padding: "1px 8px", fontVariantNumeric: "tabular-nums" }}>
      {value.toLocaleString("zh-CN")}
    </span>
  );
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function fmtSettlementCell(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  // 只去掉小数部分的尾零（"3.50"→"3.5"、"3.00"→"3"），不能动整数尾零（13050 曾被砍成 1305）
  return Number(n).toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

const SETTLEMENT_REPORT_HEADERS = [
  "店铺", "销量", "收入金额", "售后预留金额", "售后释放金额", "收入合计",
  "售后赔付", "扣款", "仓储综合服务费", "EPR费用", "广告服务费",
  "其它服务费", "销售成本", "支出合计", "预估利润", "预估利润率",
];
const SETTLEMENT_REPORT_WIDTHS = [16, 16, 16, 16, 16, 16, 16, 21, 21, 21, 21, 16, 16, 16, 16, 16];

function roundSettlementNumber(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "";
  return Number(n.toFixed(digits));
}

function buildSettlementExportRows(rows: SettlementRow[]) {
  return [
    SETTLEMENT_REPORT_HEADERS,
    ...rows.map((r) => [
      r.store,
      roundSettlementNumber(r.qty, 0),
      roundSettlementNumber(r.income),
      roundSettlementNumber(r.reserve),
      roundSettlementNumber(r.release),
      roundSettlementNumber(r.income_total),
      roundSettlementNumber(r.after_sale),
      roundSettlementNumber(r.deduction),
      roundSettlementNumber(r.warehouse_fee),
      roundSettlementNumber(r.epr_fee),
      roundSettlementNumber(r.ad_fee),
      roundSettlementNumber(r.other_fee),
      roundSettlementNumber(r.cost),
      roundSettlementNumber(r.expense_total),
      r.profit != null ? roundSettlementNumber(r.profit) : "",
      r.profit_rate != null ? roundSettlementNumber(r.profit_rate * 100) : "",
    ]),
  ];
}

async function downloadSettlementXlsx(filename: string, rows: SettlementRow[]) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(buildSettlementExportRows(rows));
  ws["!cols"] = SETTLEMENT_REPORT_WIDTHS.map((wch) => ({ wch }));
  (ws as any)["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, filename);
}

// ===== 结算报表：将 fund_detail 按类别映射到 Excel 列 =====
interface SettlementRow {
  mall_id: string;
  store: string;
  owner: string;
  qty: number;           // 销量（C 口径=已结算订单件数；回退 salesv2 窗口）
  cost_source: "order" | "salesv2"; // 销量/成本口径来源
  order_coverage: number | null;    // 订单明细金额 ÷ 已结算货款（C 口径覆盖率，<0.95 提示未采全）
  est_qty: number;       // 空批次估算补足件数（平台未提供明细的批次按本店实际件均价折算）
  est_cost: number;      // 空批次估算补足成本（按本店实际成本率折算）
  income: number;        // 收入金额
  reserve: number;       // 售后预留金额（待结算）
  release: number;       // 售后释放金额（已到账）
  income_total: number;  // 收入合计
  after_sale: number;    // 售后赔付
  deduction: number;     // 扣款
  warehouse_fee: number; // 仓储综合服务费
  epr_fee: number;       // EPR费用
  ad_fee: number;        // 广告服务费
  other_fee: number;     // 其它服务费
  cost: number;          // 销售成本
  expense_total: number; // 支出合计
  net_amount: number;    // 资金净额 = 收入合计 − 费用合计（不含销售成本，聚水潭口径）
  available_amount: number;
  frozen_amount: number;
  balance_amount: number;
  violation_count: number;
  epr_wait: number;                       // EPR 待扣合计（erp_temu_epr_fee 明细）
  fund_frozen: FundFrozenData | null;     // 资金限制明细（点击冻结资金查看）
  account_total: number;                  // 账户总额（账户概览）
  fulfillment_total: number;              // 履约费用流出合计
  account_overview: AccountOverviewData | null;   // 账户概览明细
  fulfillment_bill: FulfillmentBillData | null;   // 履约费用明细（点击查看）
  violation_detail: ViolationData | null; // 违规明细（点击违规数查看）
  profit: number | null; // 预估利润（未采到结算数据的店为 null，不假亏）
  profit_rate: number | null; // 预估利润率
}

interface SettlementStoreData {
  mall_id: string;
  store_code: string | null;
  mall_name: string | null;
  owner: string | null;
  fund_detail: FundDetailData | null;
  fund_summary: FundSummaryData | null;
  risk_detail: SettlementRiskData | null;
  epr_detail: EprDetailData | null;
  fund_frozen: FundFrozenData | null;
  account_overview: AccountOverviewData | null;
  fulfillment_bill: FulfillmentBillData | null;
  violation: ViolationData | null;
  settlement_income: number;       // 真实结算收入（income-summary）
  settlement_income_days: number;  // 结算数据覆盖天数
  cost: number;                    // 销量×加权均价（salesv2 × erp_skus，A 口径近似）
  qty: number;
  settlement_detail: StoreSettlementDetail | null;
  // C 口径：已结算订单明细（与收入同批货）。amount 用于覆盖率 = amount ÷ 已结算货款
  order_detail: { qty: number; qty_costed: number; cost: number; amount: number } | null;
}

function classifyFundCategories(fd: FundDetailData | null) {
  let warehouseFee = 0, eprFee = 0, adFee = 0, afterSale = 0, deduction = 0, otherFee = 0;
  if (fd?.by_category) {
    for (const [cat, amt] of Object.entries(fd.by_category)) {
      if (amt >= 0) continue;
      const absAmt = Math.abs(amt);
      const lower = cat.toLowerCase();
      // 聚水潭口径：提现是资金转出、结算冲减属收入侧（已含在 income-summary），都不算经营费用
      if (lower === "提现" || lower === "结算") {
        continue;
      } else if (lower.includes("仓储综合服务费") || (lower.includes("仓储") && lower.includes("服务费"))) {
        warehouseFee += absAmt;
      } else if (lower.includes("epr") || lower.includes("环保")) {
        eprFee += absAmt;
      } else if (lower.includes("推广") || lower.includes("广告")) {
        adFee += absAmt;
      } else if (lower.includes("赔付") || lower.includes("售后赔") || lower.includes("售后问题") || lower.includes("履约保障") || lower.includes("售后补贴")) {
        afterSale += absAmt;
      } else if (lower.includes("扣款") || lower.includes("违规") || lower.includes("罚款") || lower.includes("处罚") || lower.includes("质量事故")) {
        deduction += absAmt;
      } else {
        otherFee += absAmt;
      }
    }
  }
  return { warehouseFee, eprFee, adFee, afterSale, deduction, otherFee };
}

function buildSettlementRowFromData(s: SettlementStoreData): SettlementRow {
  const store = formatStoreNo(s.store_code, s.mall_id);
  const owner = s.owner || "";
  const fd = s.fund_detail;
  const fs = s.fund_summary;
  const risk = s.risk_detail;
  const sd = s.settlement_detail;
  // 聚水潭口径（与 Temu 结算单原生字段对齐，只取已结算行）：
  //   收入金额 = incomeAmount（已结算货款，物化列 sales_receipt_amount）
  //   售后预留 = afsReverseAmount（物化列 chargeback_amount，列名历史误称）
  //   售后释放 = afsReleaseAmount（物化列 subsidy_amount，列名历史误称）
  //   收入合计 = 收入 − 预留 + 释放 = Temu 结算单合计（settled.total）
  // income-summary 逐日收入是另一口径，不进报表列（仅趋势图使用）。
  const income = sd?.settled?.sales_receipt || 0;
  const reserve = sd?.settled?.chargeback || 0;
  const release = sd?.settled?.subsidy || 0;
  const income_total = income - reserve + release;
  const fees = classifyFundCategories(fd);
  // 销量/成本：优先 C 口径（已结算订单明细，与收入同批货）；未采到订单明细的店回退 salesv2 窗口近似。
  const od = s.order_detail;
  const useOrder = !!od && od.qty > 0;
  // 覆盖率 = 订单明细金额 ÷ 资金入账流水「结算」类合计（同为入账口径，分母不能用结算汇总卡片）
  const settleInflow = fd?.by_category?.["结算"] || 0;
  const order_coverage = useOrder && settleInflow > 0 ? od.amount / settleInflow : null;
  // 空批次估算补足（配比原则）：平台对零元/小币种尾差批次只给总额不给明细行，这部分收入已入账、
  // 货也真实发出，成本不能记 0。按本店本窗口已覆盖部分的实际成本率/件均价折算补足，并在 UI 标注估算。
  let est_qty = 0;
  let est_cost = 0;
  if (useOrder && settleInflow > od.amount && od.amount > 0) {
    const uncovered = settleInflow - od.amount;
    est_qty = Math.round(uncovered / (od.amount / od.qty));
    est_cost = uncovered * (od.cost / od.amount);
  }
  const qty = useOrder ? od.qty + est_qty : (s.qty || 0);
  const cost = useOrder ? od.cost + est_cost : (s.cost || 0);
  const fee_total = fees.afterSale + fees.deduction + fees.warehouseFee + fees.eprFee + fees.adFee + fees.otherFee;
  const expense_total = fee_total + cost;
  // 资金净额：纯钱进钱出（聚水潭口径），不含销售成本
  const net_amount = income_total - fee_total;
  // 预估利润：只对采到结算数据的店计算，没数据的店不假亏
  const hasSettlementData = (s.settlement_income_days || 0) > 0 || income_total > 0 || !!fd;
  const profit = hasSettlementData ? income_total - expense_total : null;
  const profit_rate = profit != null && income_total > 0 ? profit / income_total : null;
  return {
    mall_id: s.mall_id, store, owner, qty,
    cost_source: useOrder ? "order" : "salesv2",
    order_coverage,
    est_qty, est_cost,
    income, reserve, release, income_total,
    after_sale: fees.afterSale, deduction: fees.deduction, warehouse_fee: fees.warehouseFee,
    epr_fee: fees.eprFee, ad_fee: fees.adFee, other_fee: fees.otherFee,
    cost, expense_total, net_amount,
    available_amount: fs?.available_amount || 0,
    frozen_amount: fs?.frozen_amount || 0,
    balance_amount: fs?.balance_amount || 0,
    // 违规数优先用主动采集的明细表（含申诉状态），无明细时回退云端泛化风险快照
    violation_count: s.violation
      ? s.violation.violation_count
      : (risk?.violation_count || 0) + (risk?.inbound_exception_count || 0),
    epr_wait: s.epr_detail?.wait_amount || 0,
    fund_frozen: s.fund_frozen,
    account_total: s.account_overview?.total_amount || 0,
    fulfillment_total: s.fulfillment_bill?.overview_amount || s.fulfillment_bill?.detail_total || 0,
    account_overview: s.account_overview,
    fulfillment_bill: s.fulfillment_bill,
    violation_detail: s.violation,
    profit, profit_rate,
  };
}

// 日期工具
function dateStr(d: Date): string { return d.toISOString().slice(0, 10); }
function monthStart(offset = 0): string {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
  return dateStr(d);
}
function monthEnd(offset = 0): string {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset + 1); d.setDate(0);
  return dateStr(d);
}
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return dateStr(d);
}

export default function MultiStoreReport() {
  const [loading, setLoading] = useState(false);
  const [settlementSyncing, setSettlementSyncing] = useState(false);
  const [data, setData] = useState<ReportData | null>(
    () => readPageCache<ReportData | null>(MULTI_STORE_REPORT_CACHE_KEY, null),
  );
  const [error, setError] = useState<string | null>(null);
  const msrViewKey = (suffix: string) => `temu.multi-store-report.${suffix}`;
  const [activeTab, setActiveTab] = useSessionState(msrViewKey("tab"), "daily");
  const [ownerFilter, setOwnerFilter] = useSessionState<string>(msrViewKey("owner"), "all");
  const [savingMall, setSavingMall] = useState<string | null>(null);
  // 销售管理 Tab（SKU 明细，懒加载）
  const [skuRows, setSkuRows] = useState<SkuRow[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuLoaded, setSkuLoaded] = useState(false);
  const [skuStoreFilter, setSkuStoreFilter] = useSessionState(msrViewKey("skuStore"), "all");
  const [skuStatusFilter, setSkuStatusFilter] = useSessionState(msrViewKey("skuStatus"), "all");
  const [skuSearchInput, setSkuSearchInput] = useSessionState(msrViewKey("skuSearch"), "");
  const [shopHealthRows, setShopHealthRows] = useState<ShopHealthRow[]>([]);
  const [shopHealthLoaded, setShopHealthLoaded] = useState(false);
  // 搜索框防抖：输入框绑 skuSearchInput 跟手，下游过滤用防抖后的 skuSearch（变量名不变，下游无需改）。
  const skuSearch = useDebouncedValue(skuSearchInput, 250);

  // 仓内库存 Tab（按店铺聚合，懒加载）
  const [invRows, setInvRows] = useState<any[]>([]);
  const [invSummary, setInvSummary] = useState<any>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invLoaded, setInvLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.multiStore) {
      setError("当前版本不支持多店报表（IPC 未注册），请升级桌面端");
      return;
    }
    setLoading(true);
    try {
      const [resp, shopHealthResp] = await Promise.all([
        window.electronAPI.erp.reports.multiStore({ includeTest: false }) as Promise<MultiStoreResponse>,
        window.electronAPI.erp.reports.shopHealth
          ? window.electronAPI.erp.reports.shopHealth({ includeTest: false }).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (shopHealthResp?.ok && shopHealthResp.data) {
        setShopHealthRows((shopHealthResp.data.rows || []) as ShopHealthRow[]);
        setShopHealthLoaded(true);
      } else {
        setShopHealthRows([]);
        setShopHealthLoaded(false);
      }
      if (!resp.ok || !resp.data) {
        setError(resp.error || "未知错误");
        setData(null);
      } else {
        setData(resp.data);
        setError(null);
        writePageCache(MULTI_STORE_REPORT_CACHE_KEY, resp.data);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      setData(null);
      setShopHealthRows([]);
      setShopHealthLoaded(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncSettlementIncome = useCallback(async () => {
    if (!window.electronAPI?.erp?.syncTemuSettlementIncomeFromCloud) {
      message.error("当前版本不支持结算收入同步，请升级桌面端");
      return;
    }
    setSettlementSyncing(true);
    try {
      const resp = await window.electronAPI.erp.syncTemuSettlementIncomeFromCloud({});
      if (!resp?.ok) {
        message.error(resp?.error || "结算收入同步失败");
        return;
      }
      const result = resp.result || {};
      if (result.attached === false) {
        message.warning("未挂载 cloud 抓包库，暂时没有可同步的结算数据");
        return;
      }
      if (result.ok === false) {
        message.warning("cloud 抓包库已挂载，但结算抓包表不可用或同步未完成，请先跑预检");
        return;
      }
      const incomeRows = result.incomeRows ?? result.rows ?? 0;
      const detailRows = result.detailRows ?? 0;
      const fundRows = result.fundRows ?? 0;
      const orderRows = result.orderRows ?? 0;
      const fundSummaryRows = result.fundSummaryRows ?? 0;
      const eprRows = result.eprRows ?? 0;
      const frozenRows = result.frozenRows ?? 0;
      const violationRows = result.violationRows ?? 0;
      message.success(`结算数据已同步：${result.malls || 0} 店 / 收入 ${incomeRows} 行 / 明细 ${detailRows} 行 / 费用 ${fundRows} 行 / 订单 ${orderRows} 行 / 资金汇总 ${fundSummaryRows} 行 / EPR ${eprRows} 行 / 资金限制 ${frozenRows} 行 / 违规 ${violationRows} 行`);
      await load();
    } catch (e: any) {
      message.error(e?.message || String(e));
    } finally {
      setSettlementSyncing(false);
    }
  }, [load]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const allStores = data?.stores || [];
  const finAvailable = data?.financials_available ?? false;
  const settlementAvailable = data?.settlement_available ?? false;
  const settlementDetailAvailable = data?.settlement_detail_available ?? false;
  const salesWindow = data?.sales_window ?? null;
  const windowDays = salesWindow?.days && salesWindow.days > 0 ? salesWindow.days : 0;
  const label30 = windowDays > 0 && windowDays < 30 ? `近 ${windowDays} 天` : "近 30 天";

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of allStores) if (s.owner) set.add(s.owner);
    return Array.from(set).sort();
  }, [allStores]);

  const stores = useMemo(() => {
    if (ownerFilter === "all") return allStores;
    if (ownerFilter === UNASSIGNED) return allStores.filter((s) => !s.owner);
    return allStores.filter((s) => s.owner === ownerFilter);
  }, [allStores, ownerFilter]);

  const shopHealthByMall = useMemo(() => {
    return new Map(shopHealthRows.map((row) => [row.mall_id, row]));
  }, [shopHealthRows]);

  const getStoreSales = useCallback((store: ReportStore): StoreSalesView => {
    const health = shopHealthByMall.get(store.mall_id);
    if (health) {
      return {
        today: health.sale_volume || 0,
        last7d: health.sale_7d || 0,
        last30d: health.sale_30d || 0,
        stat_date: health.stat_date || null,
        source: "shopHealth",
      };
    }
    if (store.shop_stats?.stat_date) {
      return {
        today: store.shop_stats.sale_volume || 0,
        last7d: store.shop_stats.sale_7d || 0,
        last30d: store.shop_stats.sale_30d || 0,
        stat_date: store.shop_stats.stat_date || null,
        source: "shopStats",
      };
    }
    return {
      today: store.sales?.today_qty || 0,
      last7d: store.sales?.last7d_qty || 0,
      last30d: store.sales?.last30d_qty || 0,
      stat_date: null,
      source: "sales",
    };
  }, [shopHealthByMall]);

  const storeSalesRows = useMemo(() => {
    return stores
      .map((store) => ({ store, sales: getStoreSales(store) }))
      .sort((a, b) => b.sales.today - a.sales.today || b.sales.last7d - a.sales.last7d);
  }, [stores, getStoreSales]);

  const saveOwner = useCallback(async (mallId: string, owner: string | null) => {
    if (!window.electronAPI?.erp?.reports?.setMallOwner) {
      message.error("当前版本不支持设置负责人，请升级桌面端");
      return;
    }
    setSavingMall(mallId);
    try {
      const resp = await window.electronAPI.erp.reports.setMallOwner({ mallId, owner: owner || null });
      if (resp.ok) {
        message.success("已保存");
        load();
      } else {
        message.error(resp.error || "保存失败");
      }
    } catch (e: any) {
      message.error(e?.message || String(e));
    } finally {
      setSavingMall(null);
    }
  }, [load]);

  // 销售管理：进 Tab 懒加载 SKU 明细（数据量大，不随主报表一起拉）
  const loadSkuSales = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.skuSales) return;
    setSkuLoading(true);
    try {
      const resp = await window.electronAPI.erp.reports.skuSales({ includeTest: false });
      if (resp.ok && resp.data) {
        setSkuRows((resp.data.rows || []) as SkuRow[]);
        setSkuLoaded(true);
      }
    } catch { /* ignore */ } finally {
      setSkuLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "sales" && !skuLoaded && !skuLoading) loadSkuSales();
  }, [activeTab, skuLoaded, skuLoading, loadSkuSales]);

  const loadWarehouseInventory = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.warehouseInventory) return;
    setInvLoading(true);
    try {
      const resp = await window.electronAPI.erp.reports.warehouseInventory({ includeTest: false });
      if (resp.ok && resp.data) {
        setInvRows(resp.data.stores || []);
        setInvSummary(resp.data.summary || null);
        setInvLoaded(true);
      }
    } catch { /* ignore */ } finally {
      setInvLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "warehouse" && !invLoaded && !invLoading) loadWarehouseInventory();
  }, [activeTab, invLoaded, invLoading, loadWarehouseInventory]);

  const skuStoreOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of skuRows) if (r.store_code) set.add(r.store_code);
    return Array.from(set).sort();
  }, [skuRows]);

  const skuView = useMemo(() => {
    let rows = skuRows;
    if (skuStoreFilter !== "all") rows = rows.filter((r) => r.store_code === skuStoreFilter);
    if (skuStatusFilter === "soldout") rows = rows.filter((r) => r.stock <= 0);
    else if (skuStatusFilter === "low") rows = rows.filter((r) => r.stock > 0 && r.advice_qty > 0);
    else if (skuStatusFilter === "selling") rows = rows.filter((r) => r.stock > 0);
    const q = skuSearch.trim().toLowerCase();
    if (q) rows = rows.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.title || "").toLowerCase().includes(q) || (r.skc_id || "").includes(q));
    return rows;
  }, [skuRows, skuStoreFilter, skuStatusFilter, skuSearch]);

  const summary = useMemo(() => {
    if (!stores.length) return null;
    const onlineCount = stores.filter((s) => s.health.lag_seconds != null && s.health.lag_seconds < STALE_THRESHOLD_SECONDS).length;
    const totalPending = stores.reduce((acc, s) => acc + (s.stock_orders.pending || 0), 0);
    const rev30 = stores.reduce((acc, s) => acc + (s.financials?.last30d.revenue || 0), 0);
    const gp30 = stores.reduce((acc, s) => acc + (s.financials?.last30d.gross_profit || 0), 0);
    const revToday = stores.reduce((acc, s) => acc + (s.financials?.today.revenue || 0), 0);
    const settlementToday = stores.reduce((acc, s) => acc + (s.settlement?.today.income || 0), 0);
    const settlement30 = stores.reduce((acc, s) => acc + (s.settlement?.last30d.income || 0), 0);
    const settleWait = stores.reduce((acc, s) => acc + (s.settlement_detail?.wait_settlement.estimated || 0), 0);
    const settleIn = stores.reduce((acc, s) => acc + (s.settlement_detail?.in_settlement.total || 0), 0);
    const settleDone = stores.reduce((acc, s) => acc + (s.settlement_detail?.settled.total || 0), 0);
    const warehouseValue = stores.reduce((acc, s) => acc + (s.inventory?.warehouse_value || 0), 0);
    const inTransitValue = stores.reduce((acc, s) => acc + (s.inventory?.in_transit_value || 0), 0);
    const salesToday = stores.reduce((acc, s) => acc + getStoreSales(s).today, 0);
    const sales7d = stores.reduce((acc, s) => acc + getStoreSales(s).last7d, 0);
    const sales30d = stores.reduce((acc, s) => acc + getStoreSales(s).last30d, 0);
    return { onlineCount, totalPending, rev30, gp30, revToday, settlementToday, settlement30, settleWait, settleIn, settleDone, warehouseValue, inTransitValue, salesToday, sales7d, sales30d, margin30: rev30 > 0 ? gp30 / rev30 : null };
  }, [stores, getStoreSales]);

  // 全局趋势（合并各店 trend_daily）
  const combinedTrend = useMemo(() => {
    const m = new Map<string, { date: string; revenue: number; gross_profit: number }>();
    for (const s of stores) {
      for (const t of s.financials?.trend_daily ?? []) {
        const e = m.get(t.date) || { date: t.date, revenue: 0, gross_profit: 0 };
        e.revenue += t.revenue;
        e.gross_profit += t.gross_profit;
        m.set(t.date, e);
      }
    }
    return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [stores]);

  const combinedSettlementTrend = useMemo(() => {
    const m = new Map<string, { date: string; income: number }>();
    for (const s of stores) {
      for (const t of s.settlement?.trend_daily ?? []) {
        const e = m.get(t.date) || { date: t.date, income: 0 };
        e.income += t.income;
        m.set(t.date, e);
      }
    }
    return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [stores]);

  // ===== 结算报表（独立数据源 + 时间段选择器）=====
  const [stlRange, setStlRange] = useSessionState<[string, string]>(msrViewKey("stlRange"), [daysAgo(30), dateStr(new Date())]);
  const [stlData, setStlData] = useState<SettlementStoreData[]>([]);
  const [stlFundAvail, setStlFundAvail] = useState(false);
  const [stlLoading, setStlLoading] = useState(false);
  const [stlLoaded, setStlLoaded] = useState(false);

  const loadSettlement = useCallback(async (start?: string, end?: string) => {
    if (!window.electronAPI?.erp?.reports?.settlement) return;
    setStlLoading(true);
    try {
      const resp = await window.electronAPI.erp.reports.settlement({
        startDate: start || stlRange[0],
        endDate: end || stlRange[1],
      });
      if (resp.ok && resp.data) {
        setStlData((resp.data.stores || []) as SettlementStoreData[]);
        setStlFundAvail(resp.data.fund_detail_available ?? false);
        setStlLoaded(true);
      }
    } catch { /* ignore */ } finally {
      setStlLoading(false);
    }
  }, [stlRange]);

  // 进入结算 Tab 时懒加载
  useEffect(() => {
    if (activeTab === "settlement" && !stlLoaded && !stlLoading) loadSettlement();
  }, [activeTab, stlLoaded, stlLoading, loadSettlement]);

  const stlPresets: Array<{ label: string; range: [string, string] }> = useMemo(() => [
    { label: "近7天", range: [daysAgo(7), dateStr(new Date())] },
    { label: "近30天", range: [daysAgo(30), dateStr(new Date())] },
    { label: "本月", range: [monthStart(0), dateStr(new Date())] },
    { label: "上月", range: [monthStart(-1), monthEnd(-1)] },
  ], []);

  const handleStlRangeChange = useCallback((range: [string, string]) => {
    setStlRange(range);
    setStlLoaded(false);
    void loadSettlement(range[0], range[1]);
  }, [loadSettlement, setStlRange]);

  const settlementRows = useMemo(() => stlData
    .map(buildSettlementRowFromData)
    .sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity) || a.store.localeCompare(b.store, "zh-CN")),
  [stlData]);

  // 店铺营收排名（Top 15，营收毛利 Tab 横向条形）
  const revRank = useMemo(() => stores
    .filter((s) => s.financials)
    .map((s) => ({ name: s.store_code || s.mall_id.slice(-4), rev: Math.round(s.financials!.last30d.revenue), margin: marginOf(s.financials!.last30d) }))
    .sort((a, b) => b.rev - a.rev)
    .slice(0, 15), [stores]);

  // 营收二八分布：前 N 家贡献 80% 营收
  const pareto = useMemo(() => {
    const arr = stores.map((s) => s.financials?.last30d.revenue || 0).filter((v) => v > 0).sort((a, b) => b - a);
    const total = arr.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let cum = 0, n = 0;
    for (const v of arr) { cum += v; n++; if (cum >= total * 0.8) break; }
    return { topN: n, total: arr.length };
  }, [stores]);

  // 按负责人卷积
  const ownerRollup = useMemo(() => {
    const m = new Map<string, {
      owner: string;
      store_count: number;
      sales_today: number;
      sales_7d: number;
      sales_30d: number;
      rev30: number;
      gp30: number;
      pending: number;
      after_sales: number;
      risk: number;
    }>();
    for (const s of stores) {
      const key = s.owner || "(未分配)";
      const r = m.get(key) || { owner: key, store_count: 0, sales_today: 0, sales_7d: 0, sales_30d: 0, rev30: 0, gp30: 0, pending: 0, after_sales: 0, risk: 0 };
      const sales = getStoreSales(s);
      r.store_count += 1;
      r.sales_today += sales.today;
      r.sales_7d += sales.last7d;
      r.sales_30d += sales.last30d;
      r.rev30 += s.financials?.last30d.revenue || 0;
      r.gp30 += s.financials?.last30d.gross_profit || 0;
      r.pending += s.stock_orders.pending || 0;
      r.after_sales += s.after_sales.count || 0;
      r.risk += 0; // 风险数当前 by-store 未透出，预留
      m.set(key, r);
    }
    return Array.from(m.values()).sort((a, b) => b.sales_today - a.sales_today || b.rev30 - a.rev30);
  }, [stores, getStoreSales]);

  // 异常预警
  const alerts = useMemo(() => {
    const out: Array<{ key: string; level: "error" | "warning"; text: string }> = [];
    for (const s of stores) {
      const code = s.store_code || s.mall_id;
      const who = s.owner ? `（${s.owner}）` : "";
      if (s.health.lag_seconds == null || s.health.lag_seconds >= STALE_THRESHOLD_SECONDS) {
        out.push({ key: `${s.mall_id}-lag`, level: "error", text: `${code}${who} 采集滞后/掉线（${fmtLag(s.health.lag_seconds)}前）` });
      }
      const m30 = marginOf(s.financials?.last30d);
      if (m30 != null && m30 < ALERT_MARGIN_LOW) {
        out.push({ key: `${s.mall_id}-margin`, level: "warning", text: `${code}${who} 近 30 天毛利率偏低（${fmtPct(m30)}）` });
      }
      const asr = parseAfterSaleRatio(s.shop_stats.after_sale_ratio_90d);
      if (asr != null && asr > ALERT_AFTER_SALE_RATIO) {
        out.push({ key: `${s.mall_id}-asr`, level: "warning", text: `${code}${who} 90 天售后率偏高（${asr}%）` });
      }
      if ((s.shop_stats.already_sold_out_skc || 0) > 0) {
        out.push({ key: `${s.mall_id}-soldout`, level: "warning", text: `${code}${who} 已售罄 ${s.shop_stats.already_sold_out_skc} 个 SKC` });
      }
    }
    return out;
  }, [stores]);

  // 各待办列的最大值（用于热力色阶归一化）
  const maxes = useMemo(() => ({
    pending: Math.max(1, ...stores.map((s) => s.stock_orders.pending || 0)),
    lack: Math.max(1, ...stores.map((s) => s.shop_stats.lack_skc || 0)),
    soldout: Math.max(1, ...stores.map((s) => s.shop_stats.already_sold_out_skc || 0)),
    aftersale: Math.max(1, ...stores.map((s) => s.after_sales.count || 0)),
  }), [stores]);

  // 顶部「今日要点」汇总
  const highlights = useMemo(() => {
    const offline = stores.filter((s) => s.health.lag_seconds == null || s.health.lag_seconds >= STALE_THRESHOLD_SECONDS).length;
    const soldout = stores.reduce((a, s) => a + (s.shop_stats.already_sold_out_skc || 0), 0);
    const lack = stores.reduce((a, s) => a + (s.shop_stats.lack_skc || 0), 0);
    const aftersale = stores.reduce((a, s) => a + (s.after_sales.count || 0), 0);
    const lowMargin = stores.filter((s) => { const m = marginOf(s.financials?.last30d); return m != null && m < ALERT_MARGIN_LOW; }).length;
    return { offline, soldout, lack, aftersale, lowMargin };
  }, [stores]);

  // 运营日报按紧急度排序：掉线/售罄/缺货/售后/待发 的店置顶
  const dailyStores = useMemo(() => {
    const urgency = (s: ReportStore) => {
      let u = 0;
      if (s.health.lag_seconds == null || s.health.lag_seconds >= STALE_THRESHOLD_SECONDS) u += 100000;
      u += (s.shop_stats.already_sold_out_skc || 0) * 100;
      u += (s.shop_stats.lack_skc || 0) * 50;
      u += (s.after_sales.count || 0) * 30;
      u += (s.stock_orders.pending || 0);
      return u;
    };
    return [...stores].sort((a, b) => urgency(b) - urgency(a));
  }, [stores]);

  // === 销售管理：店铺销量列 ===
  const storeSalesColumns: ColumnsType<(typeof storeSalesRows)[number]> = [
    { title: "店号", key: "code", width: 110, fixed: "left", render: (_, r) => <StoreCell store={r.store} />, sorter: (a, b) => (a.store.store_code || "").localeCompare(b.store.store_code || "") },
    { title: "店铺", key: "name", width: 170, render: (_, r) => storeNameCell(r.store), sorter: (a, b) => (a.store.mall_name || "").localeCompare(b.store.mall_name || "") },
    { title: "今日销量", key: "today", width: 100, align: "right", render: (_, r) => fmtNum(r.sales.today), sorter: (a, b) => a.sales.today - b.sales.today, defaultSortOrder: "descend" },
    { title: "7日销量", key: "last7d", width: 100, align: "right", render: (_, r) => fmtNum(r.sales.last7d), sorter: (a, b) => a.sales.last7d - b.sales.last7d },
    { title: "30日销量", key: "last30d", width: 110, align: "right", render: (_, r) => fmtNum(r.sales.last30d), sorter: (a, b) => a.sales.last30d - b.sales.last30d },
    { title: "在售", key: "onSale", width: 90, align: "right", render: (_, r) => fmtNum(shopHealthByMall.get(r.store.mall_id)?.on_sale ?? r.store.shop_stats.on_sale_skc) },
    { title: "缺货 SKC", key: "lack", width: 90, align: "right", render: (_, r) => <HeatNum value={shopHealthByMall.get(r.store.mall_id)?.lack_skc ?? r.store.shop_stats.lack_skc} max={maxes.lack} hue="gold" /> },
    { title: "数据源", key: "source", width: 120, render: (_, r) => r.sales.source === "shopHealth" ? <Tag color="green">官方聚合</Tag> : r.sales.source === "shopStats" ? <Tag color="blue">店铺快照</Tag> : <Tag>SKU汇总</Tag> },
  ];

  // === 销售管理：SKU 明细列 ===
  const salesColumns: ColumnsType<SkuRow> = [
    { title: "店号", dataIndex: "store_code", width: 78, fixed: "left", render: (v) => <Typography.Text strong>{formatStoreNo(v)}</Typography.Text>, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || "") },
    { title: "店铺", dataIndex: "mall_name", width: 130, render: (v: string | null) => <span style={{ color: "#555" }}>{formatMallName(v)}</span> },
    {
      title: "SKU / 商品", key: "sku", width: 300,
      render: (_, r) => (
        <div>
          <Typography.Text copyable={{ text: r.sku_ext_code || "" }} style={{ fontSize: 12 }}>{r.sku_ext_code || "(无货号)"}</Typography.Text>
          <Tooltip title={r.title || ""}>
            <div style={{ color: "#888", fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</div>
          </Tooltip>
        </div>
      ),
    },
    { title: "今日销量", dataIndex: "today", width: 90, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.today - b.today },
    { title: "近 7 天", dataIndex: "last7d", width: 88, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last7d - b.last7d, defaultSortOrder: "descend" },
    { title: "近 30 天", dataIndex: "last30d", width: 92, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last30d - b.last30d },
    { title: "库存", dataIndex: "stock", width: 100, align: "right", render: (v: number, r) => <span style={{ color: v <= 0 ? COLOR.bad : undefined }}>{fmtNum(v)}{r.occupy > 0 ? <span style={{ color: "#aaa", fontSize: 11 }}> /占{fmtNum(r.occupy)}</span> : null}</span>, sorter: (a, b) => a.stock - b.stock },
    { title: "可售天数", dataIndex: "sale_days", width: 88, align: "right", render: (v: number | null) => (v == null ? "—" : <span style={{ color: v < 7 ? COLOR.warn : undefined }}>{v}天</span>), sorter: (a, b) => (a.sale_days ?? Infinity) - (b.sale_days ?? Infinity) },
    { title: "申报价", dataIndex: "declared_price", width: 88, align: "right", render: (v: number | null) => (v == null ? "—" : "¥" + v.toFixed(2)), sorter: (a, b) => (a.declared_price ?? 0) - (b.declared_price ?? 0) },
    { title: "状态", key: "status", width: 96, render: (_, r) => { const s = skuStatus(r); return <Tag color={s.color}>{s.text}</Tag>; } },
  ];

  // === Tab 1: 运营日报 ===
  const dailyColumns: ColumnsType<ReportStore> = [
    { title: "店号", key: "code", width: 110, fixed: "left", render: (_, s) => <StoreCell store={s} />, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || "") },
    { title: "店铺", key: "name", width: 170, render: (_, s) => storeNameCell(s), sorter: storeNameSorter },
    { title: "今日销量", key: "salesToday", width: 90, align: "right", render: (_, s) => fmtNum(getStoreSales(s).today), sorter: (a, b) => getStoreSales(a).today - getStoreSales(b).today },
    { title: "近 7 天", key: "sales7d", width: 90, align: "right", render: (_, s) => fmtNum(getStoreSales(s).last7d), sorter: (a, b) => getStoreSales(a).last7d - getStoreSales(b).last7d },
    { title: "近 30 天", key: "sales30d", width: 95, align: "right", render: (_, s) => fmtNum(getStoreSales(s).last30d), sorter: (a, b) => getStoreSales(a).last30d - getStoreSales(b).last30d },
    { title: "待发备货", dataIndex: ["stock_orders", "pending"], width: 95, align: "right", render: (v: number) => <HeatNum value={v} max={maxes.pending} hue="orange" />, sorter: (a, b) => (a.stock_orders.pending || 0) - (b.stock_orders.pending || 0) },
    { title: "缺货", dataIndex: ["shop_stats", "lack_skc"], width: 80, align: "right", render: (v: number) => <HeatNum value={v} max={maxes.lack} hue="gold" />, sorter: (a, b) => (a.shop_stats.lack_skc || 0) - (b.shop_stats.lack_skc || 0) },
    { title: "已售罄", dataIndex: ["shop_stats", "already_sold_out_skc"], width: 80, align: "right", render: (v: number) => <HeatNum value={v} max={maxes.soldout} hue="red" />, sorter: (a, b) => (a.shop_stats.already_sold_out_skc || 0) - (b.shop_stats.already_sold_out_skc || 0) },
    { title: "待处理售后", dataIndex: ["after_sales", "count"], width: 100, align: "right", render: (v: number) => <HeatNum value={v} max={maxes.aftersale} hue="red" />, sorter: (a, b) => (a.after_sales.count || 0) - (b.after_sales.count || 0) },
    {
      title: "数据上报", key: "lag", width: 110,
      render: (_, s) => {
        const sec = s.health.lag_seconds;
        const stale = sec != null && sec >= STALE_THRESHOLD_SECONDS;
        return (
          <Badge
            status={lagColor(sec) as "success" | "processing" | "error" | "default"}
            text={<span style={{ fontSize: 12, color: stale ? COLOR.bad : "#888" }}>{sec == null ? "未上报" : `${fmtLag(sec)}前`}</span>}
          />
        );
      },
      sorter: (a, b) => (a.health.lag_seconds ?? Infinity) - (b.health.lag_seconds ?? Infinity),
    },
  ];

  // === Tab 2: 营收毛利（金额）===
  const bossColumns: ColumnsType<ReportStore> = [
    { title: "店号", key: "code", width: 110, fixed: "left", render: (_, s) => <StoreCell store={s} />, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || "") },
    { title: "店铺", key: "name", width: 170, render: (_, s) => storeNameCell(s), sorter: storeNameSorter },
    { title: "近 7 天结算", key: "settle7", width: 120, align: "right", render: (_, s) => fmtMoney(s.settlement?.last7d.income), sorter: (a, b) => (a.settlement?.last7d.income || 0) - (b.settlement?.last7d.income || 0) },
    { title: "结算 7 天环比", key: "settleWow", width: 100, align: "right", render: (_, s) => <DeltaTag value={s.settlement?.last7d.income_wow ?? null} /> },
    { title: "近 30 天结算", key: "settle30", width: 120, align: "right", render: (_, s) => fmtMoney(s.settlement?.last30d.income), sorter: (a, b) => (a.settlement?.last30d.income || 0) - (b.settlement?.last30d.income || 0) },
    { title: "待处理款项", key: "settleWait", width: 120, align: "right", render: (_, s) => fmtMoney(s.settlement_detail?.wait_settlement.estimated), sorter: (a, b) => (a.settlement_detail?.wait_settlement.estimated || 0) - (b.settlement_detail?.wait_settlement.estimated || 0) },
    { title: "结算中款项", key: "settleIn", width: 120, align: "right", render: (_, s) => fmtMoney(s.settlement_detail?.in_settlement.total), sorter: (a, b) => (a.settlement_detail?.in_settlement.total || 0) - (b.settlement_detail?.in_settlement.total || 0) },
    { title: "已到账款项", key: "settleDone", width: 120, align: "right", render: (_, s) => fmtMoney(s.settlement_detail?.settled.total), sorter: (a, b) => (a.settlement_detail?.settled.total || 0) - (b.settlement_detail?.settled.total || 0) },
    { title: "近 7 天营收", key: "rev7", width: 120, align: "right", render: (_, s) => fmtMoney(s.financials?.last7d.revenue), sorter: (a, b) => (a.financials?.last7d.revenue || 0) - (b.financials?.last7d.revenue || 0), defaultSortOrder: "descend" },
    { title: "7 天环比", key: "wow", width: 90, align: "right", render: (_, s) => <DeltaTag value={s.financials?.last7d.rev_wow ?? null} /> },
    { title: "近 30 天营收", key: "rev30", width: 120, align: "right", render: (_, s) => fmtMoney(s.financials?.last30d.revenue), sorter: (a, b) => (a.financials?.last30d.revenue || 0) - (b.financials?.last30d.revenue || 0) },
    { title: "30 天环比", key: "mom", width: 90, align: "right", render: (_, s) => <DeltaTag value={s.financials?.last30d.rev_mom ?? null} /> },
    { title: "近 30 天毛利", key: "gp30", width: 120, align: "right", render: (_, s) => fmtMoney(s.financials?.last30d.gross_profit), sorter: (a, b) => (a.financials?.last30d.gross_profit || 0) - (b.financials?.last30d.gross_profit || 0) },
    {
      title: "毛利率", key: "margin", width: 110, align: "right",
      render: (_, s) => {
        const m = marginOf(s.financials?.last30d);
        const cov = s.financials?.cost_coverage;
        const node = <span style={{ color: marginColor(m), fontWeight: 600 }}>{fmtPct(m)}</span>;
        if (cov != null && cov < 0.9) {
          return <Tooltip title={`成本覆盖 ${fmtPct(cov, 0)}，未覆盖 SKU 按 0 成本，毛利率偏高`}>{node} <Typography.Text type="secondary" style={{ fontSize: 11 }}>*</Typography.Text></Tooltip>;
        }
        return node;
      },
      sorter: (a, b) => (marginOf(a.financials?.last30d) ?? -1) - (marginOf(b.financials?.last30d) ?? -1),
    },
    {
      title: <Tooltip title="官方平台仓可售库存(warehouse_stock) × 加权均价；成本未覆盖 SKU 按 0 计，为下限值"><span style={{ borderBottom: "1px dotted #bbb", cursor: "help" }}>仓内货值</span></Tooltip>,
      key: "wh_value", width: 120, align: "right",
      render: (_, s) => (s.inventory?.warehouse_value ? <span style={{ color: "#1677ff" }}>{fmtMoney(s.inventory.warehouse_value)}</span> : <span style={{ color: "#bbb" }}>—</span>),
      sorter: (a, b) => (a.inventory?.warehouse_value || 0) - (b.inventory?.warehouse_value || 0),
    },
    {
      title: <Tooltip title="官方在途/待入库库存(wait_in_stock：已发往 Temu 仓待签收 + 待入库) × 加权均价；成本未覆盖 SKU 按 0 计，为下限值"><span style={{ borderBottom: "1px dotted #bbb", cursor: "help" }}>在途货值</span></Tooltip>,
      key: "transit_value", width: 120, align: "right",
      render: (_, s) => (s.inventory?.in_transit_value ? <span style={{ color: "#d46b08" }}>{fmtMoney(s.inventory.in_transit_value)}</span> : <span style={{ color: "#bbb" }}>—</span>),
      sorter: (a, b) => (a.inventory?.in_transit_value || 0) - (b.inventory?.in_transit_value || 0),
    },
    {
      title: "30 天趋势", key: "trend", width: 140,
      render: (_, s) => {
        const t = s.financials?.trend_daily ?? [];
        if (t.length < 2) return <span style={{ color: "#bbb" }}>—</span>;
        return (
          <ResponsiveContainer width="100%" height={36}>
            <LineChart data={t}>
              <Line type="monotone" dataKey="revenue" stroke="#1677ff" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        );
      },
    },
  ];

  // === Tab 3: 团队管理 ===
  const managerColumns: ColumnsType<(typeof ownerRollup)[number]> = [
    { title: "负责人", dataIndex: "owner", key: "owner", width: 140, fixed: "left", render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
    { title: "管理店数", dataIndex: "store_count", key: "store_count", width: 100, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.store_count - b.store_count },
    { title: "今日销量", dataIndex: "sales_today", key: "sales_today", width: 100, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.sales_today - b.sales_today, defaultSortOrder: "descend" },
    { title: "7日销量", dataIndex: "sales_7d", key: "sales_7d", width: 100, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.sales_7d - b.sales_7d },
    { title: "30日销量", dataIndex: "sales_30d", key: "sales_30d", width: 110, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.sales_30d - b.sales_30d },
    { title: "近 30 天营收", dataIndex: "rev30", key: "rev30", width: 130, align: "right", render: (v) => fmtMoney(v), sorter: (a, b) => a.rev30 - b.rev30 },
    { title: "近 30 天毛利", dataIndex: "gp30", key: "gp30", width: 130, align: "right", render: (v) => fmtMoney(v), sorter: (a, b) => a.gp30 - b.gp30 },
    { title: "毛利率", key: "margin", width: 100, align: "right", render: (_, r) => { const m = r.rev30 > 0 ? r.gp30 / r.rev30 : null; return <span style={{ color: marginColor(m), fontWeight: 600 }}>{fmtPct(m)}</span>; } },
    { title: "待发备货", dataIndex: "pending", key: "pending", width: 100, align: "right", render: (v: number) => (v > 0 ? <Tag color="orange">{fmtNum(v)}</Tag> : "—"), sorter: (a, b) => a.pending - b.pending },
    { title: "待处理售后", dataIndex: "after_sales", key: "after_sales", width: 110, align: "right", render: (v: number) => (v > 0 ? <Tag color="volcano">{fmtNum(v)}</Tag> : "—"), sorter: (a, b) => a.after_sales - b.after_sales },
  ];

  // === Tab 4: 店铺归属 ===
  const ownerEditColumns: ColumnsType<ReportStore> = [
    { title: "店号", dataIndex: "store_code", width: 90, fixed: "left", render: (v, r) => <Typography.Text strong>{formatStoreNo(v, r.mall_id)}</Typography.Text>, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || ""), defaultSortOrder: "ascend" },
    { title: "店铺名", dataIndex: "mall_name", width: 200, render: (v: string | null) => formatMallName(v, "(未命名)") },
    { title: "站点", dataIndex: "site", width: 120, render: (v) => v || "—" },
    {
      title: "运营负责人", key: "owner", width: 220,
      render: (_, s) => (
        <AutoComplete
          style={{ width: 180 }}
          defaultValue={s.owner || ""}
          options={ownerOptions.map((o) => ({ value: o }))}
          placeholder="输入负责人姓名"
          disabled={savingMall === s.mall_id}
          filterOption={(input, opt) => (opt?.value || "").toLowerCase().includes(input.toLowerCase())}
          onBlur={(e) => {
            const next = (e.target as HTMLInputElement).value.trim();
            if (next !== (s.owner || "")) saveOwner(s.mall_id, next);
          }}
        />
      ),
    },
  ];

  // === Tab 5: 运维监控 ===
  const opsColumns: ColumnsType<ReportStore> = [
    { title: "店号", key: "code", width: 110, fixed: "left", render: (_, s) => <StoreCell store={s} />, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || "") },
    { title: "店铺", key: "name", width: 170, render: (_, s) => storeNameCell(s), sorter: storeNameSorter },
    {
      title: "状态", key: "status", width: 100,
      render: (_, s) => {
        const sec = s.health.lag_seconds;
        if (sec == null) return <Badge status="default" text="从未上报" />;
        if (sec < 600) return <Badge status="success" text="实时" />;
        if (sec < STALE_THRESHOLD_SECONDS) return <Badge status="processing" text="活跃" />;
        return <Badge status="error" text="滞后" />;
      },
      sorter: (a, b) => (a.health.lag_seconds ?? Infinity) - (b.health.lag_seconds ?? Infinity), defaultSortOrder: "descend",
    },
    { title: "最近上报", key: "last_capture", width: 140, render: (_, s) => (s.health.last_capture_at ? <Tooltip title={new Date(s.health.last_capture_at).toLocaleString("zh-CN")}><span>{fmtLag(s.health.lag_seconds)}前</span></Tooltip> : <span style={{ color: "#999" }}>无</span>), sorter: (a, b) => (a.health.last_capture_at || 0) - (b.health.last_capture_at || 0) },
    { title: "累计抓取", dataIndex: ["health", "captures_total"], width: 100, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => (a.health.captures_total || 0) - (b.health.captures_total || 0) },
    { title: "店铺数据日期", dataIndex: ["shop_stats", "stat_date"], width: 120, render: (v) => v || <span style={{ color: "#999" }}>—</span> },
    { title: "mall_id", dataIndex: "mall_id", width: 170, render: (v) => <Typography.Text type="secondary" copyable={{ text: v }}>{v}</Typography.Text> },
  ];

  const tabItems = [
    {
      key: "daily",
      label: "运营日报",
      children: (
        <>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <Statistic title="今日销量" value={fmtNum(summary?.salesToday || 0)} valueStyle={{ fontSize: 20, color: "#1677ff" }} />
            <Statistic title="7日销量" value={fmtNum(summary?.sales7d || 0)} valueStyle={{ fontSize: 20, color: "#1677ff" }} />
            <Statistic title="30日销量" value={fmtNum(summary?.sales30d || 0)} valueStyle={{ fontSize: 20, color: "#1677ff" }} />
            <Statistic title="待发备货" value={summary?.totalPending || 0} valueStyle={{ fontSize: 20, color: (summary?.totalPending || 0) > 0 ? "#fa8c16" : undefined }} />
            <Statistic title="缺货 SKC" value={highlights.lack} valueStyle={{ fontSize: 20, color: highlights.lack > 0 ? "#d4b106" : undefined }} />
            <Statistic title="已售罄 SKC" value={highlights.soldout} valueStyle={{ fontSize: 20, color: highlights.soldout > 0 ? "#cf1322" : undefined }} />
            <Statistic title="待处理售后" value={highlights.aftersale} valueStyle={{ fontSize: 20, color: highlights.aftersale > 0 ? "#cf1322" : undefined }} />
          </div>
          <div style={{ padding: "8px 16px 0", color: "#888", fontSize: 12 }}>已按紧急度排序：掉线 / 售罄 / 缺货 / 待处理售后 / 待发 多的店自动置顶。</div>
          <Table<ReportStore> dataSource={dailyStores} columns={dailyColumns} rowKey="mall_id" size="small" pagination={false} scroll={{ x: 1040 }} loading={loading} />
        </>
      ),
    },
    {
      key: "sales",
      label: "销售管理",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <Statistic title="今日销量" value={fmtNum(summary?.salesToday || 0)} valueStyle={{ color: "#1677ff" }} />
            <Statistic title="7日销量" value={fmtNum(summary?.sales7d || 0)} valueStyle={{ color: "#1677ff" }} />
            <Statistic title="30日销量" value={fmtNum(summary?.sales30d || 0)} valueStyle={{ color: "#1677ff" }} />
            <Statistic title="覆盖店铺" value={storeSalesRows.length} suffix={shopHealthLoaded ? `/ 官方 ${shopHealthRows.length}` : ""} />
          </div>
          <Table
            dataSource={storeSalesRows}
            columns={storeSalesColumns}
            rowKey={(r) => r.store.mall_id}
            size="small"
            pagination={false}
            scroll={{ x: 880 }}
            loading={loading}
          />
          <div style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Select size="small" style={{ width: 130 }} value={skuStoreFilter} onChange={setSkuStoreFilter}
              options={[{ value: "all", label: "全部店铺" }, ...skuStoreOptions.map((c) => ({ value: c, label: c }))]} />
            <Select size="small" style={{ width: 130 }} value={skuStatusFilter} onChange={setSkuStatusFilter}
              options={[{ value: "all", label: "全部状态" }, { value: "soldout", label: "已售罄" }, { value: "low", label: "建议补货" }, { value: "selling", label: "在售" }]} />
            <Input.Search size="small" allowClear placeholder="搜货号 / 标题 / SKC" style={{ width: 240 }} value={skuSearchInput} onChange={(e) => setSkuSearchInput(e.target.value)} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>共 {skuView.length} 条（仅含动销或售罄 SKU，取各店最新一天）</Typography.Text>
          </div>
          <Table<SkuRow>
            dataSource={skuView}
            columns={salesColumns}
            rowKey={(r) => `${r.mall_id}|${r.skc_id || ""}|${r.sku_ext_code || ""}`}
            size="small"
            pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
            scroll={{ x: 1080 }}
            loading={skuLoading}
          />
        </div>
      ),
    },
    {
      key: "boss",
      label: "营收毛利",
      children: (
        <>
          {!finAvailable && (
            <Alert type="warning" showIcon style={{ margin: 16 }} message="金额维度暂不可用" description="未能连接 cloud 销量库（attach 失败或主控端未配置），营收/毛利显示为空。" />
          )}
          {!settlementAvailable && (
            <Alert type="info" showIcon style={{ margin: 16 }} message="实际结算维度暂不可用" description="请先同步 Temu 结算收入抓包；若仍不可用，确认迁移 081_temu_settlement_income 已执行。" />
          )}
          {finAvailable && salesWindow && windowDays > 0 && windowDays < 30 && (
            <Alert
              type="info"
              showIcon
              style={{ margin: 16 }}
              message={`营收数据目前覆盖 ${salesWindow.start} ~ ${salesWindow.end}，共 ${windowDays} 天（不足 30 天）`}
              description="“近30天”相关金额为该区间累计、非完整自然月；7天/30天环比待数据攒满对比周期后才显示。"
            />
          )}
          {finAvailable && combinedTrend.length >= 2 && (
            <div style={{ padding: "12px 16px 0" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{label30}营收 / 毛利趋势（所选范围合计）</Typography.Text>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={combinedTrend} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => String(d).slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => "¥" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)} />
                  <RTooltip formatter={(v: any) => fmtMoney(Number(v))} labelFormatter={(d) => `日期 ${d}`} />
                  <Line type="monotone" dataKey="revenue" name="营收" stroke="#1677ff" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line type="monotone" dataKey="gross_profit" name="毛利" stroke="#52c41a" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {settlementAvailable && combinedSettlementTrend.length >= 2 && (
            <div style={{ padding: "8px 16px 0" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>实际结算收入趋势（所选范围合计）</Typography.Text>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={combinedSettlementTrend} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => String(d).slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => "¥" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)} />
                  <RTooltip formatter={(v: any) => fmtMoney(Number(v))} labelFormatter={(d) => `日期 ${d}`} />
                  <Line type="monotone" dataKey="income" name="实际结算" stroke="#13c2c2" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {finAvailable && revRank.length > 0 && (
            <div style={{ padding: "8px 16px 0" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {label30}营收排名 Top {revRank.length}（条形按毛利率着色：绿好·橙中·红差）
                {pareto && <span style={{ marginLeft: 8 }}>· 前 {pareto.topN} 家贡献 80% 营收（共 {pareto.total} 家）</span>}
              </Typography.Text>
              <ResponsiveContainer width="100%" height={Math.max(160, revRank.length * 26)}>
                <BarChart data={revRank} layout="vertical" margin={{ top: 4, right: 70, bottom: 4, left: 8 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => "¥" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)} />
                  <YAxis type="category" dataKey="name" width={44} tick={{ fontSize: 11 }} />
                  <RTooltip formatter={(v: any) => fmtMoney(Number(v))} />
                  <Bar dataKey="rev" name="营收" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {revRank.map((r, i) => <Cell key={i} fill={marginColor(r.margin) || "#1677ff"} />)}
                    <LabelList dataKey="rev" position="right" formatter={(v: any) => fmtMoney(Number(v))} style={{ fontSize: 11, fill: "#666" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <Table<ReportStore> dataSource={stores} columns={bossColumns} rowKey="mall_id" size="small" pagination={false} scroll={{ x: 1580 }} loading={loading} />
        </>
      ),
    },
    {
      key: "warehouse",
      label: "仓内库存",
      children: (
        <div>
          {invSummary && (
            <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
              <Statistic title="总库存（件）" value={fmtNum(invSummary.total_qty)} />
              <Statistic title="可用库存" value={fmtNum(invSummary.available_qty)} valueStyle={{ color: COLOR.good }} />
              <Statistic title="已预留" value={fmtNum(invSummary.reserved_qty)} valueStyle={invSummary.reserved_qty > 0 ? { color: "#d46b08" } : undefined} />
              <Statistic title="库存货值" value={fmtMoney(invSummary.total_value)} valueStyle={{ fontWeight: 600 }} />
              <Statistic title="SKU 总数" value={fmtNum(invSummary.sku_count)} />
            </div>
          )}
          <div style={{ padding: "8px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#888", fontSize: 12 }}>自有仓库库存，按店铺账号聚合。货值 = 批次落地成本 x 库存件数（无成本批次按 0 计）。</span>
            {invRows.length > 0 && (
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => {
                  const header = ["店铺账号", "SKU数", "可用", "预留待发", "冻结", "残次", "返工", "总库存", "库存货值", "批次数"];
                  const body = invRows.map((r: any) => [
                    r.account_name || r.account_id, r.sku_count, r.available_qty, r.reserved_qty,
                    r.blocked_qty, r.defective_qty, r.rework_qty, r.total_qty,
                    Number(r.stock_value.toFixed(2)), r.batch_count,
                  ]);
                  const total = invRows.reduce((a: any, r: any) => ({
                    s: a.s + r.sku_count, av: a.av + r.available_qty, re: a.re + r.reserved_qty,
                    bl: a.bl + r.blocked_qty, de: a.de + r.defective_qty, rw: a.rw + r.rework_qty,
                    to: a.to + r.total_qty, va: a.va + r.stock_value, ba: a.ba + r.batch_count,
                  }), { s: 0, av: 0, re: 0, bl: 0, de: 0, rw: 0, to: 0, va: 0, ba: 0 });
                  body.push(["合计", total.s, total.av, total.re, total.bl, total.de, total.rw, total.to, Number(total.va.toFixed(2)), total.ba]);
                  downloadCsv(`仓内库存_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
                }}
              >导出 CSV</Button>
            )}
          </div>
          <Table
            dataSource={invRows}
            rowKey="account_id"
            size="small"
            pagination={false}
            scroll={{ x: 1100 }}
            loading={invLoading}
            columns={[
              { title: "店铺账号", dataIndex: "account_name", width: 160, fixed: "left" as const, render: (v: string | null, r: any) => <Typography.Text strong>{v || r.account_id}</Typography.Text>, sorter: (a: any, b: any) => (a.account_name || a.account_id).localeCompare(b.account_name || b.account_id) },
              { title: "SKU 数", dataIndex: "sku_count", width: 80, align: "right" as const, render: (v: number) => fmtNum(v), sorter: (a: any, b: any) => a.sku_count - b.sku_count },
              { title: "可用", dataIndex: "available_qty", width: 100, align: "right" as const, render: (v: number) => <span style={{ color: COLOR.good }}>{fmtNum(v)}</span>, sorter: (a: any, b: any) => a.available_qty - b.available_qty },
              { title: "预留待发", dataIndex: "reserved_qty", width: 100, align: "right" as const, render: (v: number) => v > 0 ? <span style={{ color: "#d46b08" }}>{fmtNum(v)}</span> : <span style={{ color: COLOR.muted }}>—</span>, sorter: (a: any, b: any) => a.reserved_qty - b.reserved_qty },
              { title: "冻结", dataIndex: "blocked_qty", width: 80, align: "right" as const, render: (v: number) => v > 0 ? <span style={{ color: COLOR.bad }}>{fmtNum(v)}</span> : <span style={{ color: COLOR.muted }}>—</span>, sorter: (a: any, b: any) => a.blocked_qty - b.blocked_qty },
              { title: "残次", dataIndex: "defective_qty", width: 80, align: "right" as const, render: (v: number) => v > 0 ? <span style={{ color: COLOR.bad }}>{fmtNum(v)}</span> : <span style={{ color: COLOR.muted }}>—</span>, sorter: (a: any, b: any) => a.defective_qty - b.defective_qty },
              { title: "返工", dataIndex: "rework_qty", width: 80, align: "right" as const, render: (v: number) => v > 0 ? <span style={{ color: COLOR.warn }}>{fmtNum(v)}</span> : <span style={{ color: COLOR.muted }}>—</span>, sorter: (a: any, b: any) => a.rework_qty - b.rework_qty },
              { title: "总库存", dataIndex: "total_qty", width: 100, align: "right" as const, render: (v: number) => <Typography.Text strong>{fmtNum(v)}</Typography.Text>, sorter: (a: any, b: any) => a.total_qty - b.total_qty, defaultSortOrder: "descend" as const },
              { title: "库存货值", dataIndex: "stock_value", width: 130, align: "right" as const, render: (v: number) => <Typography.Text strong>{fmtMoney(v)}</Typography.Text>, sorter: (a: any, b: any) => a.stock_value - b.stock_value },
              { title: "批次数", dataIndex: "batch_count", width: 80, align: "right" as const, render: (v: number) => fmtNum(v), sorter: (a: any, b: any) => a.batch_count - b.batch_count },
            ]}
            summary={() => {
              if (!invSummary || invRows.length === 0) return null;
              const t = invRows.reduce((acc, r) => ({
                sku: acc.sku + r.sku_count,
                avail: acc.avail + r.available_qty,
                res: acc.res + r.reserved_qty,
                blk: acc.blk + r.blocked_qty,
                def: acc.def + r.defective_qty,
                rew: acc.rew + r.rework_qty,
                tot: acc.tot + r.total_qty,
                val: acc.val + r.stock_value,
                bat: acc.bat + r.batch_count,
              }), { sku: 0, avail: 0, res: 0, blk: 0, def: 0, rew: 0, tot: 0, val: 0, bat: 0 });
              return (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ fontWeight: 600, background: "#fafafa" }}>
                    <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">{fmtNum(t.sku)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">{fmtNum(t.avail)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">{fmtNum(t.res)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">{fmtNum(t.blk)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">{fmtNum(t.def)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={6} align="right">{fmtNum(t.rew)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={7} align="right">{fmtNum(t.tot)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={8} align="right">{fmtMoney(t.val)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={9} align="right">{fmtNum(t.bat)}</Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              );
            }}
          />
        </div>
      ),
    },
    {
      key: "manager",
      label: "团队管理",
      children: (
        <div style={{ padding: 16 }}>
          {alerts.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`异常预警 ${alerts.length} 项`}
              description={
                <div style={{ fontSize: 12, maxHeight: 180, overflowY: "auto" }}>
                  {alerts.map((a) => (
                    <div key={a.key} style={{ color: a.level === "error" ? "#cf1322" : "#d46b08" }}>• {a.text}</div>
                  ))}
                </div>
              }
            />
          )}
          {ownerRollup.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12, marginBottom: 16 }}>
              {ownerRollup.map((o) => {
                const m = o.rev30 > 0 ? o.gp30 / o.rev30 : null;
                return (
                  <Card size="small" key={o.owner} bodyStyle={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography.Text strong>{o.owner}</Typography.Text>
                      <Tag>{o.store_count} 店</Tag>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 20, fontWeight: 600 }}>{finAvailable ? fmtMoney(o.rev30) : "—"}</div>
                    <div style={{ fontSize: 12, color: "#888" }}>{label30}营收 · 毛利率 <span style={{ color: marginColor(m), fontWeight: 600 }}>{finAvailable ? fmtPct(m) : "—"}</span></div>
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {o.pending > 0 && <Tag color="orange">待发 {fmtNum(o.pending)}</Tag>}
                      {o.after_sales > 0 && <Tag color="volcano">售后 {fmtNum(o.after_sales)}</Tag>}
                      {o.pending === 0 && o.after_sales === 0 && <Tag color="success">无积压</Tag>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
          <Table dataSource={ownerRollup} columns={managerColumns} rowKey="owner" size="small" pagination={false} scroll={{ x: 1130 }} loading={loading} />
        </div>
      ),
    },
    {
      key: "owners",
      label: "店铺归属",
      children: (
        <div style={{ padding: 16 }}>
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="为每家店指定运营负责人，团队管理与运营视图按此聚合 / 过滤。失焦自动保存。" />
          <Table<ReportStore> dataSource={allStores} columns={ownerEditColumns} rowKey="mall_id" size="small" pagination={false} scroll={{ x: 640 }} loading={loading} />
        </div>
      ),
    },
    {
      key: "ops",
      label: "运维监控",
      children: (
        <>
          {data?.unmapped && data.unmapped.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ margin: 16 }}
              message={`检测到 ${data.unmapped.length} 个店铺在云端有数据，但本地字典未登记`}
              description={
                <div style={{ fontSize: 12 }}>
                  {data.unmapped.map((u) => (
                    <div key={u.mall_id}>{u.mall_id} · {u.mall_name || "(未命名)"}</div>
                  ))}
                  <div style={{ marginTop: 6, color: "#888" }}>跑 <code>scripts/seed-temu-malls.cjs</code> 时把它们加上 store_code。</div>
                </div>
              }
            />
          )}
          <Table<ReportStore> dataSource={stores} columns={opsColumns} rowKey="mall_id" size="small" pagination={false} scroll={{ x: 950 }} loading={loading} />
        </>
      ),
    },
    {
      key: "purchase",
      label: "采购报表",
      children: <PurchaseReportPanel />,
    },
    {
      key: "settlement",
      label: "结算报表",
      children: (
        <div>
          {/* 时间段选择器 */}
          <div style={{ padding: "12px 16px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {stlPresets.map((p) => (
              <Button key={p.label} size="small"
                type={stlRange[0] === p.range[0] && stlRange[1] === p.range[1] ? "primary" : "default"}
                onClick={() => handleStlRangeChange(p.range)}
              >{p.label}</Button>
            ))}
            <span style={{ color: "#888", margin: "0 4px" }}>|</span>
            <input type="date" value={stlRange[0]} style={{ fontSize: 13, padding: "2px 6px" }}
              onChange={(e) => e.target.value && handleStlRangeChange([e.target.value, stlRange[1]])} />
            <span style={{ color: "#888" }}>~</span>
            <input type="date" value={stlRange[1]} style={{ fontSize: 13, padding: "2px 6px" }}
              onChange={(e) => e.target.value && handleStlRangeChange([stlRange[0], e.target.value])} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{stlRange[0]} ~ {stlRange[1]}</Typography.Text>
          </div>
          {!stlFundAvail && stlLoaded && (
            <Alert type="info" showIcon style={{ margin: "8px 16px 0" }}
              message="对账中心费用明细暂不可用"
              description={"请先在 seller.kuajingmaihuo.com 对账中心翻阅账务明细页面（被动抓包采集），然后点击「同步结算数据」。费用分类（仓储/EPR/广告/赔付等）依赖抓包数据填充。"} />
          )}
          <div style={{ padding: "8px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#888", fontSize: 12 }}>
              表格口径对齐店铺分析报告：收入合计 = 收入金额 − 售后预留金额 + 售后释放金额；支出合计 = 售后赔付 + 扣款 + 仓储综合服务费 + EPR费用 + 广告服务费 + 其它服务费 + 销售成本。
              {!stlFundAvail && stlLoaded ? " 费用列为空 = 该店尚未抓到对账数据。" : ""}
            </span>
            <Button size="small" icon={<DownloadOutlined />}
              onClick={() => {
                void downloadSettlementXlsx(`结算报表_${stlRange[0]}_${stlRange[1]}.xlsx`, settlementRows);
              }}
            >导出 Excel</Button>
          </div>
          <Table<SettlementRow>
            className="settlement-report-table"
            dataSource={settlementRows}
            rowKey="mall_id"
            size="small"
            pagination={false}
            scroll={{ x: 1740 }}
            loading={stlLoading}
            columns={[
              { title: "店铺", dataIndex: "store", key: "store", width: 120, fixed: "left",
                render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
              { title: "销量", dataIndex: "qty", key: "qty", width: 80, align: "right",
                render: (v: number, r: SettlementRow) => (
                  <Tooltip title={r.cost_source === "order"
                    ? `已结算订单件数${r.est_qty > 0 ? `（含估算补足 ${r.est_qty} 件：平台对零元/小币种尾差批次只给总额不给明细，按本店件均价折算）` : ""}${r.order_coverage != null && r.order_coverage < 0.95 ? `（订单明细仅覆盖已结算货款 ${(r.order_coverage * 100).toFixed(0)}%，批次未采全）` : ""}`
                    : "结算订单明细未采集，回退近7/30天销量近似"}>
                    <span style={r.cost_source !== "order" || (r.order_coverage != null && r.order_coverage < 0.95) ? { color: "#faad14" } : undefined}>{fmtSettlementCell(v, 0)}{r.est_qty > 0 ? <span style={{ color: "#999", fontSize: 11 }}>*</span> : null}</span>
                  </Tooltip>
                ), sorter: (a, b) => a.qty - b.qty },
              { title: "收入金额", dataIndex: "income", key: "income", width: 110, align: "right",
                render: (v: number) => fmtSettlementCell(v),
                sorter: (a, b) => a.income - b.income },
              { title: "售后预留金额", dataIndex: "reserve", key: "reserve", width: 120, align: "right",
                render: (v: number) => fmtSettlementCell(v) },
              { title: "售后释放金额", dataIndex: "release", key: "release", width: 120, align: "right",
                render: (v: number) => fmtSettlementCell(v) },
              { title: "收入合计", dataIndex: "income_total", key: "income_total", width: 110, align: "right",
                render: (v: number) => <Typography.Text style={{ color: v > 0 ? COLOR.good : undefined }}>{fmtSettlementCell(v)}</Typography.Text>,
                sorter: (a, b) => a.income_total - b.income_total },
              { title: "售后赔付", dataIndex: "after_sale", key: "after_sale", width: 100, align: "right",
                render: (v: number) => <span style={{ color: v > 0 ? COLOR.bad : undefined }}>{fmtSettlementCell(v)}</span>,
                sorter: (a, b) => a.after_sale - b.after_sale },
              { title: "扣款", dataIndex: "deduction", key: "deduction", width: 80, align: "right",
                render: (v: number) => <span style={{ color: v > 0 ? COLOR.bad : undefined }}>{fmtSettlementCell(v)}</span> },
              { title: "仓储综合服务费", dataIndex: "warehouse_fee", key: "warehouse_fee", width: 130, align: "right",
                render: (v: number) => fmtSettlementCell(v),
                sorter: (a, b) => a.warehouse_fee - b.warehouse_fee },
              { title: "EPR费用", dataIndex: "epr_fee", key: "epr_fee", width: 90, align: "right",
                render: (v: number) => fmtSettlementCell(v) },
              { title: "广告服务费", dataIndex: "ad_fee", key: "ad_fee", width: 100, align: "right",
                render: (v: number) => fmtSettlementCell(v),
                sorter: (a, b) => a.ad_fee - b.ad_fee },
              { title: "其它服务费", dataIndex: "other_fee", key: "other_fee", width: 110, align: "right",
                render: (v: number) => fmtSettlementCell(v) },
              { title: "销售成本", dataIndex: "cost", key: "cost", width: 100, align: "right",
                render: (v: number, r: SettlementRow) => (
                  <Tooltip title={r.cost_source === "order"
                    ? `已结算订单件数 × 加权均价（与收入同批货）${r.est_cost > 0 ? `（含估算补足 ¥${r.est_cost.toFixed(2)}：平台未提供明细的批次按本店实际成本率折算，保证与收入配比）` : ""}`
                    : "结算订单明细未采集，按销量近似 × 加权均价（成本未维护的 SKU 计 0，为下限值）"}>
                    <span style={r.cost_source !== "order" ? { color: "#faad14" } : undefined}>{fmtSettlementCell(v)}{r.est_cost > 0 ? <span style={{ color: "#999", fontSize: 11 }}>*</span> : null}</span>
                  </Tooltip>
                ),
                sorter: (a, b) => a.cost - b.cost },
              { title: "支出合计", dataIndex: "expense_total", key: "expense_total", width: 110, align: "right",
                render: (v: number) => <Typography.Text style={{ color: v > 0 ? COLOR.bad : undefined }}>{fmtSettlementCell(v)}</Typography.Text>,
                sorter: (a, b) => a.expense_total - b.expense_total },
              { title: "预估利润", dataIndex: "profit", key: "profit", width: 110, align: "right",
                render: (v: number | null) => v == null
                  ? <span style={{ color: "#ccc" }}>—</span>
                  : <Typography.Text strong style={{ color: v >= 0 ? COLOR.good : COLOR.bad }}>{fmtSettlementCell(v)}</Typography.Text>,
                sorter: (a, b) => (a.profit ?? -Infinity) - (b.profit ?? -Infinity) },
              { title: "利润率", dataIndex: "profit_rate", key: "profit_rate", width: 100, align: "right",
                render: (v: number | null) => {
                  if (v == null) return <span style={{ color: "#ccc" }}>—</span>;
                  const color = v < ALERT_MARGIN_LOW ? COLOR.bad : v < 0.3 ? COLOR.warn : COLOR.good;
                  return <span style={{ color }}>{fmtSettlementCell(v * 100)}</span>;
                },
                sorter: (a, b) => (a.profit_rate ?? -999) - (b.profit_rate ?? -999) },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="多店数据报表"
        extra={
          <Space>
            <Select
              size="small"
              style={{ width: 160 }}
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[
                { value: "all", label: "全部负责人" },
                ...ownerOptions.map((o) => ({ value: o, label: o })),
                { value: UNASSIGNED, label: "未分配" },
              ]}
            />
            {data?.generated_at && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                生成于 {new Date(data.generated_at).toLocaleString("zh-CN")}
              </Typography.Text>
            )}
            <Button icon={<CloudDownloadOutlined />} loading={settlementSyncing} onClick={syncSettlementIncome}>
              同步结算数据
            </Button>
            <Button icon={<ReloadOutlined />} loading={loading || stlLoading} onClick={() => { load(); if (activeTab === "settlement") loadSettlement(); message.success("已刷新"); }}>
              刷新
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        {summary && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
              <Statistic title="店铺数" value={stores.length} suffix={`/ ${summary.onlineCount} 实时`} />
              <Statistic title="今日销量" value={fmtNum(summary.salesToday)} valueStyle={{ color: "#1677ff" }} />
              <Statistic title="7日销量" value={fmtNum(summary.sales7d)} valueStyle={{ color: "#1677ff" }} />
              <Statistic title="30日销量" value={fmtNum(summary.sales30d)} valueStyle={{ color: "#1677ff" }} />
              <Statistic title="今日营收" value={finAvailable ? fmtMoney(summary.revToday) : "—"} />
              <Statistic title={`${label30}营收`} value={finAvailable ? fmtMoney(summary.rev30) : "—"} />
              <Statistic title="今日结算" value={settlementAvailable ? fmtMoney(summary.settlementToday) : "—"} />
              <Statistic title={`${label30}结算`} value={settlementAvailable ? fmtMoney(summary.settlement30) : "—"} />
              <Statistic title="待处理款项" value={settlementDetailAvailable ? fmtMoney(summary.settleWait) : "—"} valueStyle={{ color: "#faad14" }} />
              <Statistic title="结算中款项" value={settlementDetailAvailable ? fmtMoney(summary.settleIn) : "—"} valueStyle={{ color: "#13c2c2" }} />
              <Statistic title="已到账款项" value={settlementDetailAvailable ? fmtMoney(summary.settleDone) : "—"} valueStyle={{ color: "#52c41a" }} />
              <Statistic title={`${label30}毛利率`} value={finAvailable ? fmtPct(summary.margin30) : "—"} valueStyle={summary.margin30 != null ? { color: marginColor(summary.margin30) } : undefined} />
              <Statistic
                title={<Tooltip title="Temu 平台仓可售库存 × 加权均价；成本未覆盖的 SKU 按 0 计，为下限值"><span style={{ borderBottom: "1px dotted #bbb", cursor: "help" }}>仓内货值</span></Tooltip>}
                value={finAvailable ? fmtMoney(summary.warehouseValue) : "—"}
                valueStyle={{ color: "#1677ff" }}
              />
              <Statistic
                title={<Tooltip title="送仓在途（已从自有仓发出、Temu 仓未签收）× 加权均价；成本未覆盖的 SKU 按 0 计，为下限值"><span style={{ borderBottom: "1px dotted #bbb", cursor: "help" }}>在途货值</span></Tooltip>}
                value={finAvailable ? fmtMoney(summary.inTransitValue) : "—"}
                valueStyle={{ color: "#d46b08" }}
              />
              <Statistic title="待发备货合计" value={summary.totalPending} valueStyle={summary.totalPending > 0 ? { color: "#fa8c16" } : undefined} />
            </div>
            <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>今日要点</Typography.Text>
              {highlights.offline > 0 && <Tag color="error" style={{ cursor: "pointer" }} onClick={() => setActiveTab("ops")}>{highlights.offline} 家掉线</Tag>}
              {highlights.soldout > 0 && <Tag color="red" style={{ cursor: "pointer" }} onClick={() => setActiveTab("daily")}>{highlights.soldout} 个已售罄</Tag>}
              {highlights.lack > 0 && <Tag color="gold" style={{ cursor: "pointer" }} onClick={() => setActiveTab("daily")}>{highlights.lack} 个缺货</Tag>}
              {highlights.aftersale > 0 && <Tag color="volcano" style={{ cursor: "pointer" }} onClick={() => setActiveTab("daily")}>{highlights.aftersale} 待处理售后</Tag>}
              {finAvailable && highlights.lowMargin > 0 && <Tag color="orange" style={{ cursor: "pointer" }} onClick={() => setActiveTab("boss")}>{highlights.lowMargin} 家毛利率偏低</Tag>}
              {highlights.offline === 0 && highlights.soldout === 0 && highlights.lack === 0 && highlights.aftersale === 0 && <Tag color="success">暂无紧急事项</Tag>}
            </div>
          </>
        )}
      </Card>

      {error && (
        <Alert type="error" showIcon message="加载失败" description={error} style={{ marginBottom: 16 }} action={<Button onClick={load} size="small">重试</Button>} />
      )}

      {!error && allStores.length === 0 && !loading && (
        <Card>
          <Empty description="暂无店铺数据 —— 请先在主控端跑 scripts/seed-temu-malls.cjs" />
        </Card>
      )}

      {!error && allStores.length > 0 && (
        <Card bodyStyle={{ padding: 0 }}>
          <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} tabBarStyle={{ paddingLeft: 16, marginBottom: 0 }} />
        </Card>
      )}
    </div>
  );
}
