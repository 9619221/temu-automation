import { useMemo } from "react";
import type { ReactNode } from "react";
import { Empty, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { NoSearchSelect } from "../../utils/opsWorkbench";
import { useSiteExceptions } from "../../hooks/useOpsReports";
import { useStoreScope } from "../../hooks/useStoreScope";
import type { SiteExceptionRow } from "../../types/opsWorkbench";

interface SiteExceptionTabProps {
  active: boolean;
  storeFilter: string;
  search: string;
  commonFilters: (extra?: ReactNode) => ReactNode;
}

function fmtTime(v: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  } catch { return v; }
}

const REASON_SHORT: [RegExp, string][] = [
  [/暂无可销售的库存/, "无库存"],
  [/物流.*渠道.*限制/, "物流限制"],
  [/法规.*禁止销售|禁止销售/, "法规禁售"],
  [/属性.*未填写|不合规/, "属性缺失"],
  [/暂不支持在该站点售卖/, "站点不支持"],
  [/资质.*缺失|缺失.*资质/, "资质缺失"],
  [/敏感属性.*流程/, "属性审核中"],
  [/缺失说明书/, "说明书缺失"],
];
function shortReason(raw: string | null): string {
  if (!raw) return "—";
  const clean = raw.replace(/<[^>]*>/g, "").trim();
  const parts = clean.split(/[;；]\s*/);
  const tags = new Set<string>();
  for (const p of parts) {
    let matched = false;
    for (const [re, label] of REASON_SHORT) {
      if (re.test(p)) { tags.add(label); matched = true; break; }
    }
    if (!matched && p.length > 0) tags.add(p.length > 20 ? p.slice(0, 18) + "…" : p);
  }
  return [...tags].join("，") || clean;
}

type SkuInfoMap = Record<string, { ext?: string; spec?: string }>;
type GoodsInfoMap = Record<string, { title?: string; thumb?: string; skcId?: string }>;

interface SpuRow {
  key: string;
  mall_id: string;
  goods_id: string;
  title: string | null;
  thumb: string | null;
  sku_count: number;
  site_count: number;
  sites: string[];
  reasons: string[];
  latest_time: string | null;
  _rows: SiteExceptionRow[];
}

function groupBySpu(rows: SiteExceptionRow[], gi: GoodsInfoMap): SpuRow[] {
  const map = new Map<string, SpuRow>();
  for (const r of rows) {
    const gid = r.goods_id || r.sku_id;
    const k = `${r.mall_id}::${gid}`;
    let g = map.get(k);
    if (!g) {
      const info = gi[gid];
      g = { key: k, mall_id: r.mall_id, goods_id: gid, title: info?.title || null, thumb: info?.thumb || null, sku_count: 0, site_count: 0, sites: [], reasons: [], latest_time: null, _rows: [] };
      map.set(k, g);
    }
    g._rows.push(r);
  }
  for (const g of map.values()) {
    const skus = new Set<string>(), sites = new Set<string>(), reasons = new Set<string>();
    for (const c of g._rows) {
      skus.add(c.sku_id);
      if (c.site_name) sites.add(c.site_name);
      if (c.exception_reason) reasons.add(c.exception_reason);
      if (!g.latest_time || (c.exception_time || "") > g.latest_time) g.latest_time = c.exception_time;
    }
    g.sku_count = skus.size;
    g.site_count = sites.size;
    g.sites = [...sites].sort();
    g.reasons = [...reasons];
  }
  return [...map.values()].sort((a, b) => (b.latest_time || "").localeCompare(a.latest_time || ""));
}

export default function SiteExceptionTab({ active, storeFilter, search, commonFilters }: SiteExceptionTabProps) {
  const { rows: rawRows, skuInfo, goodsInfo, loading } = useSiteExceptions(active);
  const { inScope } = useStoreScope();

  const filtered = useMemo(() => {
    let list = rawRows.filter((r) => inScope(r.mall_id));
    if (storeFilter && storeFilter !== "all") list = list.filter((r) => r.mall_id === storeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        (r.sku_id || "").toLowerCase().includes(q) ||
        (r.sku_ext_code || "").toLowerCase().includes(q) ||
        (r.site_name || "").toLowerCase().includes(q) ||
        (r.exception_reason || "").toLowerCase().includes(q) ||
        (r.sku_spec || "").toLowerCase().includes(q) ||
        (r.goods_id || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [rawRows, storeFilter, search, inScope]);

  const grouped = useMemo(() => groupBySpu(filtered, goodsInfo as GoodsInfoMap), [filtered, goodsInfo]);

  const allSites = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtered) m.set(r.site_name || "未知", (m.get(r.site_name || "未知") || 0) + 1);
    return m;
  }, [filtered]);

  const spuColumns: ColumnsType<SpuRow> = [
    { title: "商品", dataIndex: "goods_id", width: 260, render: (_v, r) => (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {r.thumb ? <img src={r.thumb} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} /> : <div style={{ width: 40, height: 40, background: "#f0f0f0", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 10, color: "#bbb" }}>暂无图</div>}
        <div style={{ minWidth: 0 }}>
          {r.title ? <Typography.Text ellipsis={{ tooltip: r.title }} style={{ fontSize: 12, display: "block" }}>{r.title}</Typography.Text> : null}
          <Typography.Text copyable={{ text: r.goods_id }} style={{ fontSize: 11, color: "#999" }}>{r.goods_id}</Typography.Text>
        </div>
      </div>
    ) },
    { title: "异常SKU", dataIndex: "sku_count", width: 80, sorter: (a, b) => a.sku_count - b.sku_count, render: (v: number) => <span style={{ fontWeight: 600, color: v > 1 ? "#d46b08" : undefined }}>{v}</span> },
    { title: "异常站点", dataIndex: "sites", width: 240, filters: [...allSites.entries()].map(([s, n]) => ({ text: `${s} (${n})`, value: s })), onFilter: (v, r) => r.sites.includes(v as string),
      render: (sites: string[]) => sites.length <= 5
        ? <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>{sites.map((s) => <Tag key={s} color="orange" style={{ margin: 0 }}>{s}</Tag>)}</div>
        : <Tag color="orange">{sites.length} 个站点</Tag>,
    },
    { title: "异常原因", dataIndex: "reasons", width: 200, render: (v: string[]) => {
      const tags = [...new Set(v.map(shortReason))];
      return <span style={{ fontSize: 12 }}>{tags.join(" + ")}</span>;
    } },
    { title: "最新时间", dataIndex: "latest_time", width: 160, sorter: (a, b) => (a.latest_time || "").localeCompare(b.latest_time || ""), defaultSortOrder: "descend", render: (v: string | null) => <span style={{ fontSize: 12 }}>{fmtTime(v)}</span> },
  ];

  const skuColumns: ColumnsType<SiteExceptionRow> = [
    { title: "SKU ID", dataIndex: "sku_id", width: 150, render: (v: string, r) => {
      const ext = r.sku_ext_code || (skuInfo as SkuInfoMap)?.[v]?.ext;
      return <Typography.Text copyable={{ text: ext || v }} style={{ fontSize: 12 }}>{ext || v}</Typography.Text>;
    } },
    { title: "SKU属性", dataIndex: "sku_spec", width: 140, render: (v: string | null, r) => {
      const spec = v || (skuInfo as SkuInfoMap)?.[r.sku_id]?.spec;
      return spec ? <span style={{ fontSize: 12 }}>{spec}</span> : <span style={{ color: "#bbb" }}>—</span>;
    } },
    { title: "异常原因", dataIndex: "exception_reason", render: (v: string | null) => <span style={{ fontSize: 12 }}>{shortReason(v)}</span> },
    { title: "异常站点", dataIndex: "site_name", width: 100, render: (v: string) => <Tag color="orange">{v}</Tag> },
    { title: "异常时间", dataIndex: "exception_time", width: 160, render: (v: string | null) => <span style={{ fontSize: 12 }}>{fmtTime(v)}</span> },
  ];

  const skuCount = new Set(filtered.map((r) => r.sku_id)).size;

  return (
    <div>
      <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <Statistic title="异常商品数" value={grouped.length} valueStyle={{ color: grouped.length > 0 ? "#d46b08" : undefined }} />
        <Statistic title="异常 SKU 数" value={skuCount} />
        <Statistic title="涉及站点数" value={allSites.size} />
        <Statistic title="最新异常" value={grouped.length > 0 ? fmtTime(grouped[0]?.latest_time) : "—"} valueStyle={{ fontSize: 16 }} />
      </div>
      {commonFilters()}
      {!loading && grouped.length === 0 ? (
        <Empty description="暂无站点异常数据" style={{ padding: 40 }} />
      ) : (
        <Table<SpuRow>
          dataSource={grouped}
          columns={spuColumns}
          rowKey="key"
          size="small"
          loading={loading}
          pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个商品` }}
          scroll={{ x: 960 }}
          expandable={{
            expandedRowRender: (record) => (
              <Table<SiteExceptionRow>
                dataSource={record._rows}
                columns={skuColumns}
                rowKey={(r) => `${r.sku_id}::${r.site_name}`}
                size="small"
                pagination={false}
              />
            ),
          }}
        />
      )}
    </div>
  );
}
