import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Empty, Image, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";

const erp = window.electronAPI?.erp;

interface OfficialMall {
  mallId: string;
  mallName: string;
  productSyncCount?: number;
}

interface OfficialProductRow {
  product_id: string;
  product_name?: string;
  jit_mode?: number;
  sku_count?: number;
  product_properties_json?: string;
  raw_json?: string;
  updated_at?: string;
  // 解析自 raw_json
  _img?: string;
  _skc?: string;
  _extCode?: string;
}

function parseRaw(row: any): OfficialProductRow {
  let raw: any = {};
  try { raw = JSON.parse(row.raw_json || "{}"); } catch { raw = {}; }
  return {
    ...row,
    _img: raw.mainImageUrl || "",
    _skc: raw.productSkcId != null ? String(raw.productSkcId) : "",
    _extCode: raw.extCode || "",
  };
}

const PAGE_SIZE = 20;

/**
 * 官方 API 商品主数据浏览视图（接进「商品管理」页的「官方 API」切换）。
 * 自带店铺选择，读 erp.temuOpenApi.listProducts，跟现有抓包视图解耦、零风险。
 */
export default function OfficialProductsView() {
  const [malls, setMalls] = useState<OfficialMall[]>([]);
  const [mallId, setMallId] = useState<string>("");
  const [rows, setRows] = useState<OfficialProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // 加载已绑定店铺
  useEffect(() => {
    if (!erp?.temuOpenApi) return;
    erp.temuOpenApi.list().then((res: { malls?: any[] }) => {
      const list = (res?.malls || []).filter((m: any) => (m.productSyncCount || 0) > 0 || m.authorized);
      const opts = list.map((m: any) => ({ mallId: m.mallId, mallName: m.mallName, productSyncCount: m.productSyncCount }));
      setMalls(opts);
      if (opts.length && !mallId) setMallId(opts[0].mallId);
    }).catch(() => { /* 静默 */ });
  }, []);

  const load = useCallback(async (mid: string, pg: number) => {
    if (!erp?.temuOpenApi || !mid) return;
    setLoading(true);
    try {
      const res = await erp.temuOpenApi.listProducts({ mallId: mid, limit: PAGE_SIZE, offset: (pg - 1) * PAGE_SIZE });
      setRows((res?.products || []).map(parseRaw));
      setTotal(res?.total || 0);
    } catch (error: any) {
      message.error(error?.message || "读取官方商品失败");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (mallId) void load(mallId, page); }, [mallId, page, load]);

  const mallOptions = useMemo(
    () => malls.map((m) => ({ value: m.mallId, label: `${m.mallName || m.mallId}（${m.productSyncCount || 0}）` })),
    [malls],
  );

  const columns: ColumnsType<OfficialProductRow> = [
    {
      title: "图片", dataIndex: "_img", key: "img", width: 70,
      render: (v) => (v ? <Image src={v} width={48} height={48} style={{ objectFit: "cover" }} /> : <span style={{ color: "#ccc" }}>无图</span>),
    },
    {
      title: "商品", key: "name",
      render: (_v, r) => (
        <Space direction="vertical" size={0}>
          <span>{r.product_name || "-"}</span>
          <span style={{ color: "#667085", fontSize: 12 }}>
            productId: {r.product_id}{r._skc ? ` · SKC: ${r._skc}` : ""}
          </span>
        </Space>
      ),
    },
    { title: "货号(SPU)", dataIndex: "_extCode", key: "ext", width: 130, render: (v) => v || <span style={{ color: "#ccc" }}>-</span> },
    { title: "SKU数", dataIndex: "sku_count", key: "sku", width: 80, render: (v) => v || 0 },
    {
      title: "模式", dataIndex: "jit_mode", key: "jit", width: 90,
      render: (v) => (v ? <Tag color="geekblue">JIT</Tag> : <Tag color="gold">普通</Tag>),
    },
    {
      title: "采集时间", dataIndex: "updated_at", key: "time", width: 170,
      render: (v) => (v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "-"),
    },
  ];

  if (!erp?.temuOpenApi) {
    return <Alert type="warning" showIcon message="当前应用未加载官方接口功能，请重启应用" style={{ margin: 16 }} />;
  }

  return (
    <div style={{ padding: "8px 4px" }}>
      <Space style={{ marginBottom: 12 }} wrap>
        <Typography.Text strong>官方 API 商品主数据</Typography.Text>
        <Select
          style={{ minWidth: 240 }}
          placeholder="选择已授权店铺"
          value={mallId || undefined}
          options={mallOptions}
          onChange={(v) => { setMallId(v); setPage(1); }}
          showSearch
          optionFilterProp="label"
          notFoundContent="暂无已授权采集的店铺"
        />
        <Typography.Text type="secondary">共 {total} 个商品</Typography.Text>
      </Space>
      {malls.length === 0 ? (
        <Empty description="还没有已授权采集的店铺，请先到「账号 → Temu 授权」绑定并采集" />
      ) : (
        <Table
          size="small"
          rowKey="product_id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            onChange: (p) => setPage(p),
            showTotal: (t) => `共 ${t} 条`,
          }}
        />
      )}
    </div>
  );
}
