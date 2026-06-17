// 运营工作台「评价」Tab:批次5 阶段2 从 OperationsWorkbench 拆出。
// 自包含:自己取数(useReviews)、自持专属 filter(scoreFilter/regionFilter)、自建 view/agg/columns。
// 共享 filter(storeFilter/search)与筛选栏渲染器(commonFilters)由容器经 props 传入。
import { useMemo } from "react";
import type { ReactNode } from "react";
import { Image, Select, Statistic, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { formatStoreNo } from "../../utils/storeDisplay";
import { fmtReviewTime, NoSearchSelect } from "../../utils/opsWorkbench";
import { useReviews } from "../../hooks/useOpsReports";
import { useStoreScope } from "../../hooks/useStoreScope";
import { useSessionState } from "../../hooks/useSessionState";
import type { ReviewRow } from "../../types/opsWorkbench";

interface ReviewTabProps {
  active: boolean;                                  // = activeTab === "review";控制按需取数(组件常驻挂载,靠它门控请求)
  storeFilter: string;                              // 跨 Tab 共享:店铺过滤
  search: string;                                   // 跨 Tab 共享:防抖后的搜索词
  commonFilters: (extra?: ReactNode) => ReactNode;  // 容器持有的公共筛选栏渲染器
}

const owViewKey = (suffix: string) => `temu.ops-workbench.${suffix}`;

export default function ReviewTab({ active, storeFilter, search, commonFilters }: ReviewTabProps) {
  const { rows: reviewRows, loading: reviewLoading } = useReviews(active);
  const { inScope } = useStoreScope();
  const [scoreFilter, setScoreFilter] = useSessionState(owViewKey("scoreFilter"), "all");
  const [regionFilter, setRegionFilter] = useSessionState(owViewKey("reviewRegion"), "all");

  const reviewColumns: ColumnsType<ReviewRow> = [
    { title: "店号", dataIndex: "store_code", width: 78, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
    { title: "区域", dataIndex: "site", width: 60, align: "center", render: (v: string | null) => { const m: Record<string, string> = { agentseller: "全球", "agentseller-us": "美区", "agentseller-eu": "欧区" }; return v ? <Tag color={v === "agentseller-us" ? "blue" : v === "agentseller-eu" ? "purple" : "green"}>{m[v] || v}</Tag> : <span style={{ color: "#bbb" }}>—</span>; } },
    { title: "评分", dataIndex: "score", width: 96, align: "center", sorter: (a, b) => (a.score ?? 0) - (b.score ?? 0), render: (v: number | null) => {
      if (v == null) return <span style={{ color: "#bbb" }}>—</span>;
      const n = Math.max(0, Math.min(5, v));
      const color = v <= 3 ? "#cf1322" : v >= 4 ? "#3f8600" : "#d4b106";
      return <span style={{ color, fontWeight: 600, whiteSpace: "nowrap" }}>{"★".repeat(n)}<span style={{ color: "#999", fontWeight: 400, marginLeft: 2 }}>{v}</span></span>;
    } },
    { title: "评论内容", dataIndex: "comment", width: 440, render: (v: string | null, r) => (
      <div>
        <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", color: r.score != null && r.score <= 3 ? "#cf1322" : undefined }}>{(r.comment_zh || v) || <span style={{ color: "#bbb" }}>（仅评分,无文字）</span>}</div>
        {r.is_benefit ? <Tag color="orange" style={{ marginTop: 4 }}>福利评价</Tag> : null}
      </div>
    ) },
    { title: "晒图", key: "pics", width: 80, align: "center", render: (_, r) => {
      if (!r.pictures || !r.pictures.length) return <span style={{ color: "#bbb" }}>—</span>;
      return (
        <Image.PreviewGroup items={r.pictures}>
          <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
            <Image src={r.pictures[0]} width={56} height={56} style={{ objectFit: "cover", borderRadius: 4 }} />
            {r.pictures.length > 1 ? <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, padding: "0 4px", borderRadius: 3, lineHeight: "15px" }}>{r.pictures.length}</span> : null}
          </div>
        </Image.PreviewGroup>
      );
    } },
    { title: "商品", key: "goods", width: 240, render: (_, r) => (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, lineHeight: 1.4, maxHeight: 34, overflow: "hidden" }}>{r.goods_name || "—"}</div>
        <div style={{ fontSize: 11, color: "#8c8c8c" }}>{r.spec_summary || ""}</div>
      </div>
    ) },
    { title: "类目", dataIndex: "category_path", width: 150, ellipsis: true, render: (v: string | null) => v || "—" },
    { title: "评价时间", dataIndex: "created_at_ts", width: 140, sorter: (a, b) => (a.created_at_ts ?? 0) - (b.created_at_ts ?? 0), defaultSortOrder: "descend", render: (v: number | null) => fmtReviewTime(v) },
  ];

  const reviewView = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return reviewRows.filter((r) => {
      if (!inScope(r.store_code || r.mall_id)) return false;
      if (storeFilter !== "all" && r.store_code !== storeFilter) return false;
      if (scoreFilter === "bad" && !(r.score != null && r.score <= 3)) return false;
      if (scoreFilter === "good" && !(r.score != null && r.score >= 4)) return false;
      if (scoreFilter === "pic" && !(r.pictures && r.pictures.length)) return false;
      if (regionFilter !== "all" && r.site !== regionFilter) return false;
      if (!kw) return true;
      return [r.goods_name, r.comment, r.spec_summary, r.category_path, r.store_code].some((x) => String(x || "").toLowerCase().includes(kw));
    });
  }, [reviewRows, search, storeFilter, scoreFilter, regionFilter, inScope]);

  const reviewAgg = useMemo(() => {
    let sum = 0, scored = 0, bad = 0, pic = 0;
    for (const r of reviewView) {
      if (r.score != null) { sum += r.score; scored += 1; if (r.score <= 3) bad += 1; }
      if (r.pictures && r.pictures.length) pic += 1;
    }
    return { total: reviewView.length, avg: scored ? Number((sum / scored).toFixed(2)) : null, bad, pic };
  }, [reviewView]);

  return (
    <div>
      <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <Statistic title="评价数(当前筛选)" value={reviewAgg.total} />
        <Statistic title="平均分" value={reviewAgg.avg ?? "—"} valueStyle={{ color: reviewAgg.avg != null && reviewAgg.avg < 4 ? "#cf1322" : "#3f8600" }} suffix={reviewAgg.avg != null ? "★" : ""} />
        <Statistic title="差评 ≤3★" value={reviewAgg.bad} valueStyle={{ color: reviewAgg.bad > 0 ? "#cf1322" : undefined }} />
        <Statistic title="带图评价" value={reviewAgg.pic} />
      </div>
      <div style={{ padding: "8px 16px 0", color: "#888", fontSize: 12 }}>商品评价:运营在 Temu 后台翻看评价页时,扩展自动抓取累积(非官方 API,覆盖取决于访问情况)。默认全部评价按<b>时间倒序</b>,差评(≤3★)标红。<b>福利评价</b>是商家给返利换的好评,单独标注。</div>
      {commonFilters(
        <>
          <Select size="small" style={{ width: 120 }} value={regionFilter} onChange={setRegionFilter} options={[{ value: "all", label: "全部区域" }, { value: "agentseller", label: "全球" }, { value: "agentseller-us", label: "美区" }, { value: "agentseller-eu", label: "欧区" }]} />
          <Select size="small" style={{ width: 130 }} value={scoreFilter} onChange={setScoreFilter} options={[{ value: "all", label: "全部评分" }, { value: "bad", label: "差评 ≤3★" }, { value: "good", label: "好评 ≥4★" }, { value: "pic", label: "带图评价" }]} />
        </>,
      )}
      <Table<ReviewRow> dataSource={reviewView} columns={reviewColumns} rowKey={(r) => `${r.mall_id}|${r.review_id}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条评价` }} scroll={{ x: 1180 }} loading={reviewLoading} />
    </div>
  );
}
