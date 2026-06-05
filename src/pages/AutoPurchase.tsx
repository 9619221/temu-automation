import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Image,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, ShoppingCartOutlined, CarOutlined } from "@ant-design/icons";
import AutoShipMap from "./AutoShipMap";

const { Text, Title, Paragraph } = Typography;
const erp = window.electronAPI?.erp;

interface Candidate {
  mallId: string;
  productId: string | null;
  productSkcId: string | null;
  productSkuId: string;
  extCode: string | null;
  title: string | null;
  thumbUrl: string | null;
  specName: string | null;
  adviceQty: number;
  fullAdvice: number;
  pendingQty: number;
  needsReview: boolean;
  temuAdviceQty: number | null;
  todaySales: number | null;
  last7dSales: number | null;
  last30dSales: number | null;
  warehouseStock: number | null;
  occupyStock: number | null;
  unavailStock: number | null;
  lackQuantity: number | null;
  waitInStock: number | null;
  totalStock: number | null;
  saleDays: number | null;
  costPrice: number | null;
  estAmount: number | null;
}
interface Summary {
  count: number;
  totalQty: number;
  totalAmount: number;
  stores: number;
  costCoverage: number;
  skippedHasOrder: number;
  needsReviewCount: number;
}

const fmtMoney = (v: number | null | undefined) => (v == null ? "-" : `¥${Number(v).toFixed(2)}`);
const fmtNum = (v: number | null | undefined) => (v == null ? "-" : String(v));

export default function AutoPurchase() {
  const [loading, setLoading] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [qtyOverride, setQtyOverride] = useState<Record<string, number>>({});
  const [applying, setApplying] = useState(false);
  // 筛选
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [minSales, setMinSales] = useState<number>(0);
  const [onlyLack, setOnlyLack] = useState(false);

  const rowKey = (c: Candidate) => `${c.mallId}|${c.productSkuId}`;
  const qtyOf = useCallback((c: Candidate) => qtyOverride[rowKey(c)] ?? c.adviceQty, [qtyOverride]);

  const load = useCallback(async () => {
    if (!erp?.inventory?.action) {
      message.error("ERP 接口未就绪");
      return;
    }
    setLoading(true);
    try {
      const r: any = await erp.inventory.action({ action: "consign_auto_purchase_candidates" });
      setCandidates(Array.isArray(r?.candidates) ? r.candidates : []);
      setSummary(r?.summary || null);
      setSelectedKeys([]);
      setQtyOverride({});
    } catch (e: any) {
      message.error(e?.message || "加载备货候选失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      candidates.filter((c) => {
        if (storeFilter && c.mallId !== storeFilter) return false;
        if (onlyLack && !(c.lackQuantity && c.lackQuantity > 0)) return false;
        if (minSales > 0 && (c.last7dSales || 0) < minSales) return false;
        return true;
      }),
    [candidates, storeFilter, onlyLack, minSales],
  );

  const storeOptions = useMemo(() => {
    const s = new Set(candidates.map((c) => c.mallId));
    return [...s].map((m) => ({ label: m, value: m }));
  }, [candidates]);

  // 选中合计（按改后的数量算）
  const selectedStats = useMemo(() => {
    const sel = filtered.filter((c) => selectedKeys.includes(rowKey(c)));
    let qty = 0;
    let amount = 0;
    for (const c of sel) {
      const q = qtyOf(c);
      qty += q;
      if (c.costPrice != null) amount += q * c.costPrice;
    }
    return { count: sel.length, qty, amount: Math.round(amount * 100) / 100 };
  }, [filtered, selectedKeys, qtyOf]);

  const doApply = useCallback(() => {
    const sel = filtered.filter((c) => selectedKeys.includes(rowKey(c)));
    if (!sel.length) {
      message.warning("请先勾选要备货的 SKU");
      return;
    }
    const reviewSel = sel.filter((c) => c.needsReview).length;
    Modal.confirm({
      title: `确认申请备货 ${sel.length} 个 SKU？`,
      content: `合计 ${selectedStats.qty} 件，预估花费 ${fmtMoney(selectedStats.amount)}。${reviewSel ? `⚠️ 含 ${reviewSel} 个「突然爆单」(靠今日单撑起、未经人工审核)，确认要一起申请？ ` : ""}将按数量真实下备货单（受平台核价、当日额度上限限制）。`,
      okText: "确认申请",
      okButtonProps: { danger: true },
      cancelText: "再想想",
      onOk: async () => {
        setApplying(true);
        const hide = message.loading(`申请备货中…（${sel.length} 个）`, 0);
        try {
          const items = sel.map((c) => ({
            mallId: c.mallId,
            productSkuId: c.productSkuId,
            productSkcId: c.productSkcId,
            quantity: qtyOf(c),
          }));
          const r: any = await erp.inventory.action({ action: "consign_auto_purchase_apply", items });
          hide();
          const fails = (r?.results || []).filter((x: any) => !x.ok);
          if (r?.fail) {
            Modal.warning({
              title: `申请完成：成功 ${r.ok}、失败 ${r.fail}`,
              width: 640,
              content: (
                <div style={{ maxHeight: 320, overflow: "auto" }}>
                  {fails.slice(0, 40).map((x: any, i: number) => (
                    <div key={i} style={{ marginBottom: 4 }}>
                      <Text code>{x.productSkuId}</Text> <Text type="secondary">{x.error}</Text>
                      {x.errorCode ? <Tag style={{ marginLeft: 6 }}>{x.errorCode}</Tag> : null}
                    </div>
                  ))}
                  {fails.length > 40 ? <Text type="secondary">…其余 {fails.length - 40} 条省略</Text> : null}
                </div>
              ),
            });
          } else {
            message.success(`全部申请成功：${r.ok} 个备货单已提交`);
          }
          await load(); // 刷新：成功的会变成「已有现成单」从清单消失
        } catch (e: any) {
          hide();
          message.error(e?.message || "申请失败");
        } finally {
          setApplying(false);
        }
      },
    });
  }, [filtered, selectedKeys, selectedStats, qtyOf, load]);

  const columns: ColumnsType<Candidate> = [
    {
      title: "商品",
      key: "product",
      width: 320,
      render: (_v, c) => (
        <Space>
          {c.thumbUrl ? <Image src={c.thumbUrl} width={44} height={44} style={{ objectFit: "cover", borderRadius: 4 }} /> : null}
          <div style={{ maxWidth: 250 }}>
            <Tooltip title={c.title}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 250 }}>{c.title || "-"}</div>
            </Tooltip>
            <Text type="secondary" style={{ fontSize: 12 }}>{c.specName || ""}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: "货号 / SKU",
      key: "sku",
      width: 150,
      render: (_v, c) => (
        <div>
          <div>{c.extCode || <Text type="secondary">无货号</Text>}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{c.productSkuId}</Text>
        </div>
      ),
    },
    { title: "自算要备", dataIndex: "fullAdvice", key: "full", width: 80, align: "right", render: (v: number) => <Text type="secondary">{fmtNum(v)}</Text> },
    { title: <Tooltip title="现成「没发货、没过期」备货单已备的量，从要备的里扣掉、只补差额"><span>现成在备</span></Tooltip>, dataIndex: "pendingQty", key: "pending", width: 86, align: "right", render: (v: number) => (v > 0 ? <Text style={{ color: "#d46b08" }}>{fmtNum(v)}</Text> : <Text type="secondary">0</Text>) },
    {
      title: (
        <Tooltip title="缺口 = 自算要备 − 现成在备，就是这次申请的数量；可手动改（平台不让超它自己的建议量）">
          <span>缺口·申请</span>
        </Tooltip>
      ),
      key: "advice",
      width: 110,
      align: "right",
      render: (_v, c) => (
        <div>
          <InputNumber size="small" min={1} value={qtyOf(c)} onChange={(v) => setQtyOverride((m) => ({ ...m, [rowKey(c)]: Number(v) || 1 }))} style={{ width: 80 }} />
          {c.needsReview ? <div><Tag color="orange" style={{ marginTop: 3, fontSize: 11 }}>爆单待审</Tag></div> : null}
        </div>
      ),
    },
    { title: "今日销", dataIndex: "todaySales", key: "s0", width: 72, align: "right", render: fmtNum },
    { title: "7天销", dataIndex: "last7dSales", key: "s7", width: 72, align: "right", render: fmtNum },
    { title: "30天销", dataIndex: "last30dSales", key: "s30", width: 78, align: "right", render: fmtNum },
    { title: "可用", dataIndex: "warehouseStock", key: "stock", width: 72, align: "right", render: (v) => <span style={{ color: (v ?? 0) <= 0 ? "#cf1322" : undefined }}>{fmtNum(v)}</span> },
    { title: "预占", dataIndex: "occupyStock", key: "occupy", width: 68, align: "right", render: fmtNum },
    { title: "暂不可用", dataIndex: "unavailStock", key: "unavail", width: 86, align: "right", render: (v) => (v && v > 0 ? <span style={{ color: "#d46b08" }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "缺货", dataIndex: "lackQuantity", key: "lack", width: 72, align: "right", render: (v) => (v && v > 0 ? <Tag color="red">{v}</Tag> : fmtNum(v)) },
    { title: "在途", dataIndex: "waitInStock", key: "wait", width: 68, align: "right", render: (v) => (v && v > 0 ? <span style={{ color: "#1677ff" }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "总库存", dataIndex: "totalStock", key: "total", width: 84, align: "right", render: (v) => <Text strong style={{ color: (v ?? 0) <= 0 ? "#cf1322" : "#1a73e8" }}>{fmtNum(v)}</Text> },
    { title: "成本单价", dataIndex: "costPrice", key: "cost", width: 100, align: "right", render: fmtMoney },
    {
      title: "预估花费",
      key: "est",
      width: 110,
      align: "right",
      render: (_v, c) => {
        const cost = c.costPrice;
        return cost != null ? <Text strong>{fmtMoney(Math.round(qtyOf(c) * cost * 100) / 100)}</Text> : <Text type="secondary">无成本</Text>;
      },
    },
    { title: "店铺", dataIndex: "mallId", key: "mall", width: 130, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> },
  ];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>采购自动备货</Title>
          <Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            先算每个 SKU 要备多少（自算 = max(0, 日均销量 × 备货天数 − 总库存)，与运营工作台同口径），再扣掉现成「没发货、没过期」备货单已备的量，<b>只申请缺口</b>（缺口 = 自算要备 − 现成在备 &gt; 0 才申请）；销 0 / 库存够 / 现成单已备够 的自动不备。总库存 = 可用 + 暂不可用 − 缺货 + 在途。
          </Paragraph>
        </div>
        <Space>
          <Button icon={<CarOutlined />} onClick={() => setShowMap(true)}>快递映射</Button>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        </Space>
      </div>

      <Modal open={showMap} onCancel={() => setShowMap(false)} footer={null} width="90%" title="快递映射（自动发货按这表选快递）" destroyOnClose styles={{ body: { padding: 0 } }}>
        <AutoShipMap />
      </Modal>

      {summary ? (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Row gutter={16}>
            <Col span={4}><Statistic title="待备 SKU" value={summary.count} suffix="个" /></Col>
            <Col span={4}><Statistic title="合计件数" value={summary.totalQty} suffix="件" /></Col>
            <Col span={5}><Statistic title="预估总花费" value={summary.totalAmount} precision={2} prefix="¥" /></Col>
            <Col span={4}><Statistic title="可自动备" value={summary.count - summary.needsReviewCount} suffix="个" valueStyle={{ color: "#3f8600" }} /></Col>
            <Col span={4}><Statistic title="爆单待审" value={summary.needsReviewCount} suffix="个" valueStyle={{ color: "#d46b08" }} /></Col>
            <Col span={3}><Statistic title="跳过" value={summary.skippedHasOrder} suffix="个" valueStyle={{ color: "#999" }} /></Col>
          </Row>
          {summary.costCoverage < summary.count ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8 }}
              message={`其中 ${summary.count - summary.costCoverage} 个 SKU 本地无成本价，预估花费不含这些（不影响申请）。`}
            />
          ) : null}
        </Card>
      ) : null}

      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          placeholder="按店铺筛选"
          style={{ width: 200 }}
          options={storeOptions}
          value={storeFilter}
          onChange={(v) => setStoreFilter(v || null)}
        />
        <span>
          近7日销 ≥
          <InputNumber size="small" min={0} value={minSales} onChange={(v) => setMinSales(Number(v) || 0)} style={{ width: 70, marginLeft: 6 }} />
        </span>
        <Checkbox checked={onlyLack} onChange={(e) => setOnlyLack(e.target.checked)}>只看缺货</Checkbox>
        <Text type="secondary">显示 {filtered.length} / {candidates.length} 个</Text>
      </Space>

      <Table<Candidate>
        rowKey={rowKey}
        size="small"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 个` }}
        scroll={{ x: 1950, y: "calc(100vh - 430px)" }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as string[]),
        }}
      />

      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: 12,
          padding: "10px 16px",
          background: "#fff",
          borderTop: "1px solid #f0f0f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Space>
          <Button onClick={() => setSelectedKeys(filtered.filter((c) => !c.needsReview).map(rowKey))} disabled={!filtered.length}>全选可自动</Button>
        <Button onClick={() => setSelectedKeys(filtered.map(rowKey))} disabled={!filtered.length}>全选(含爆单)</Button>
          <Button onClick={() => setSelectedKeys([])} disabled={!selectedKeys.length}>清空</Button>
          <Text>
            已选 <Text strong>{selectedStats.count}</Text> 个 · 合计 <Text strong>{selectedStats.qty}</Text> 件 · 预估{" "}
            <Text strong type="danger">{fmtMoney(selectedStats.amount)}</Text>
          </Text>
        </Space>
        <Button
          type="primary"
          danger
          icon={<ShoppingCartOutlined />}
          loading={applying}
          disabled={!selectedStats.count}
          onClick={doApply}
        >
          一键申请备货（{selectedStats.count}）
        </Button>
      </div>
    </div>
  );
}
