import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Select, Space, Table, Tag, Typography, Upload, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, DownloadOutlined, UploadOutlined, SaveOutlined } from "@ant-design/icons";

const { Text, Title, Paragraph } = Typography;
const erp = window.electronAPI?.erp;

interface ProductRow {
  mallId: string;
  productId: string;
  extCode: string | null;
  productName: string | null;
  expressCompanyId: string | null;
  expressCompanyName: string | null;
  pickupPref: string | null;
  configured: boolean;
}

const PICKUP_OPTIONS = [
  { value: "asap", label: "尽快" },
  { value: "morning", label: "上午" },
  { value: "afternoon", label: "下午" },
  { value: "evening", label: "晚上" },
];
const STRATEGY_OPTIONS = [
  { value: "most_used_then_cheapest", label: "平台常用优先，退最便宜" },
  { value: "cheapest", label: "最便宜" },
  { value: "most_used", label: "平台常用" },
];

export default function AutoShipMap() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [def, setDef] = useState<{ carrierStrategy: string; pickupPref: string }>({ carrierStrategy: "most_used_then_cheapest", pickupPref: "asap" });
  const [edits, setEdits] = useState<Record<string, { expressCompanyName?: string; pickupPref?: string }>>({});
  const [saving, setSaving] = useState(false);

  const rowKey = (r: ProductRow) => `${r.mallId}|${r.productId}`;
  const carrierOf = (r: ProductRow) => edits[rowKey(r)]?.expressCompanyName ?? r.expressCompanyName ?? "";
  const pickupOf = (r: ProductRow) => edits[rowKey(r)]?.pickupPref ?? r.pickupPref ?? "";
  const setEdit = (r: ProductRow, patch: { expressCompanyName?: string; pickupPref?: string }) =>
    setEdits((m) => ({ ...m, [rowKey(r)]: { ...m[rowKey(r)], ...patch } }));

  const load = useCallback(async () => {
    if (!erp?.inventory?.action) { message.error("ERP 接口未就绪"); return; }
    setLoading(true);
    try {
      const [p, d]: any[] = await Promise.all([
        erp.inventory.action({ action: "auto_ship_map_products" }),
        erp.inventory.action({ action: "auto_ship_default_get" }),
      ]);
      setRows(Array.isArray(p?.products) ? p.products : []);
      if (d?.default) setDef(d.default);
      setEdits({});
    } catch (e: any) {
      message.error(e?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveEdits = useCallback(async () => {
    const upserts = rows.filter((r) => edits[rowKey(r)]).map((r) => ({
      mallId: r.mallId, productId: r.productId, extCode: r.extCode, productName: r.productName,
      expressCompanyName: carrierOf(r), pickupPref: pickupOf(r),
    }));
    if (!upserts.length) { message.info("没有改动"); return; }
    setSaving(true);
    try {
      await erp.inventory.action({ action: "auto_ship_map_upsert", rows: upserts });
      message.success(`已保存 ${upserts.length} 条`);
      await load();
    } catch (e: any) {
      message.error(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }, [edits, rows, load]);

  const saveDefault = useCallback(async (next: { carrierStrategy: string; pickupPref: string }) => {
    try {
      await erp.inventory.action({ action: "auto_ship_default_set", carrierStrategy: next.carrierStrategy, pickupPref: next.pickupPref });
      setDef(next);
      message.success("默认策略已更新");
    } catch (e: any) {
      message.error(e?.message || "更新失败");
    }
  }, []);

  const exportXlsx = useCallback(async () => {
    const XLSX = await import("xlsx");
    const data = rows.map((r) => ({
      店铺: r.mallId, SPU: r.productId, 货号: r.extCode || "", 商品名: r.productName || "",
      快递: carrierOf(r), 揽收时段: pickupOf(r),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "快递映射");
    XLSX.writeFile(wb, "快递映射_待配.xlsx");
  }, [rows, edits]);

  const importXlsx = useCallback(async (file: File) => {
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const upserts = data.map((d) => ({
        mallId: String(d["店铺"] ?? d["mallId"] ?? "").trim(),
        productId: String(d["SPU"] ?? d["商品ID"] ?? d["productId"] ?? "").trim(),
        extCode: d["货号"] != null ? String(d["货号"]) : null,
        productName: d["商品名"] != null ? String(d["商品名"]) : null,
        expressCompanyName: d["快递"] != null ? String(d["快递"]).trim() : null,
        pickupPref: d["揽收时段"] != null ? String(d["揽收时段"]).trim() : null,
      })).filter((u) => u.mallId && u.productId);
      if (!upserts.length) { message.warning("没解析到有效行（需要 店铺 / 商品ID 列）"); return false; }
      await erp.inventory.action({ action: "auto_ship_map_upsert", rows: upserts });
      message.success(`导入 ${upserts.length} 条`);
      await load();
    } catch (e: any) {
      message.error(e?.message || "导入失败");
    }
    return false; // 阻止 antd 自动上传
  }, [load]);

  const columns: ColumnsType<ProductRow> = [
    { title: "店铺", dataIndex: "mallId", width: 130, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> },
    { title: "商品", key: "p", render: (_v, r) => <div><div style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.productName || "-"}</div><Text type="secondary" style={{ fontSize: 12 }}>SPU {r.productId}{r.extCode ? ` · 货号 ${r.extCode}` : ""}</Text></div> },
    { title: "快递", key: "carrier", width: 190, render: (_v, r) => <Input size="small" placeholder="留空=退默认" value={carrierOf(r)} onChange={(e) => setEdit(r, { expressCompanyName: e.target.value })} /> },
    { title: "揽收时段", key: "pickup", width: 130, render: (_v, r) => <Select size="small" allowClear placeholder="退默认" style={{ width: 110 }} options={PICKUP_OPTIONS} value={pickupOf(r) || undefined} onChange={(v) => setEdit(r, { pickupPref: v || "" })} /> },
    { title: "状态", key: "st", width: 80, render: (_v, r) => (carrierOf(r) ? <Tag color="green">已配</Tag> : <Tag>未配</Tag>) },
  ];

  const configuredCount = useMemo(() => rows.filter((r) => (edits[rowKey(r)]?.expressCompanyName ?? r.expressCompanyName ?? "")).length, [rows, edits]);

  return (
    <div style={{ padding: 16 }}>
      <Title level={4} style={{ margin: 0 }}>自动发货 · 快递映射</Title>
      <Paragraph type="secondary" style={{ margin: "4px 0 12px" }}>
        给「已接单待发货」的商品配指定快递 + 揽收时段；自动发货时按商品查这表选快递，没配的退默认策略。可逐行改，或 Excel 批量导入（导出 → 填快递/揽收 → 导回）。
      </Paragraph>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Text>默认策略（没配的商品用）：</Text>
          <Select style={{ width: 230 }} options={STRATEGY_OPTIONS} value={def.carrierStrategy} onChange={(v) => saveDefault({ carrierStrategy: v, pickupPref: def.pickupPref })} />
          <Text>默认揽收：</Text>
          <Select style={{ width: 110 }} options={PICKUP_OPTIONS} value={def.pickupPref} onChange={(v) => saveDefault({ carrierStrategy: def.carrierStrategy, pickupPref: v })} />
        </Space>
      </Card>

      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        <Button icon={<DownloadOutlined />} onClick={exportXlsx}>导出 Excel（待配）</Button>
        <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={(f) => importXlsx(f as unknown as File)}>
          <Button icon={<UploadOutlined />}>导入 Excel</Button>
        </Upload>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!Object.keys(edits).length} onClick={saveEdits}>保存改动（{Object.keys(edits).length}）</Button>
        <Text type="secondary">共 {rows.length} 个待配商品，已配 {configuredCount}</Text>
      </Space>

      <Table<ProductRow>
        rowKey={rowKey}
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 个` }}
        scroll={{ y: "calc(100vh - 360px)" }}
      />
    </div>
  );
}
