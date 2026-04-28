import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Image,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  LinkOutlined,
  QuestionCircleTwoTone,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

interface PriceReviewRow {
  snapshot_id: string;
  scanned_at: number;
  spu_id: string;
  sku_id: string;
  skc_id: string;
  title: string;
  main_image: string;
  sku_spec: string;
  original_price: number | null;
  seller_current_price: number | null;
  reference_price: number | null;
  price_diff: number | null;
  price_diff_pct: number | null;
  review_status: string;
  change_count: number;
  cost_1688: number | null;
  cost_manual: number | null;
  cost_source: string;
  pass_175: 0 | 1 | null;
  detail_url: string;
}

interface Summary { total: number; pass: number; fail: number; unknown: number; }

type Filter = "all" | "fail" | "pass" | "unknown";

declare global {
  interface Window {
    electronAPI?: any;
  }
}

const MARGIN_RATIO = 1.75;

export default function PriceReview() {
  const [rows, setRows] = useState<PriceReviewRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, pass: 0, fail: 0, unknown: 0 });
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [manualCostModal, setManualCostModal] = useState<{ open: boolean; sku: PriceReviewRow | null; value: number | null }>({
    open: false, sku: null, value: null,
  });

  const load = useCallback(async (nextFilter: Filter = filter) => {
    if (!window.electronAPI?.priceReview) {
      message.warning("priceReview API 未就绪，请重启客户端");
      return;
    }
    setLoading(true);
    try {
      const payload: any = {};
      if (nextFilter === "fail") payload.onlyFail = true;
      else if (nextFilter === "pass") payload.onlyPass = true;
      else if (nextFilter === "unknown") payload.onlyUnknown = true;
      const result = await window.electronAPI.priceReview.list(payload);
      setRows(result?.rows || []);
      setSummary(result?.summary || { total: 0, pass: 0, fail: 0, unknown: 0 });
      setSnapshotId(result?.snapshotId || null);
    } catch (e: any) {
      message.error("加载失败：" + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load("all"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 监听自动扫描完成
  useEffect(() => {
    const api = window.electronAPI?.priceReview;
    if (!api?.onAutoScanDone) return;
    const off = api.onAutoScanDone(() => {
      message.info("自动扫描完成，已刷新");
      load(filter);
    });
    return () => { try { off?.(); } catch {} };
  }, [filter, load]);

  const handleScanNow = useCallback(async () => {
    setScanning(true);
    try {
      await window.electronAPI.priceReview.scanNow({ marginRatio: MARGIN_RATIO });
      message.success("扫描完成");
      await load(filter);
    } catch (e: any) {
      message.error("扫描失败：" + (e?.message || String(e)));
    } finally {
      setScanning(false);
    }
  }, [filter, load]);

  const handle1688Login = useCallback(async () => {
    try {
      await window.electronAPI.priceReview.open1688Login();
      message.info("已打开 1688 登录页，扫码登录后关闭窗口即可");
    } catch (e: any) {
      message.error("打开 1688 登录页失败：" + (e?.message || String(e)));
    }
  }, []);

  const handleSaveManualCost = useCallback(async () => {
    const { sku, value } = manualCostModal;
    if (!sku) return;
    try {
      await window.electronAPI.priceReview.setManualCost(sku.sku_id, value);
      message.success("手填成本已保存，下次扫描生效");
      setManualCostModal({ open: false, sku: null, value: null });
      await load(filter);
    } catch (e: any) {
      message.error("保存失败：" + (e?.message || String(e)));
    }
  }, [manualCostModal, filter, load]);

  const handleClearManualCost = useCallback(async (skuId: string) => {
    try {
      await window.electronAPI.priceReview.clearManualCost(skuId);
      message.success("已清除手填，下次扫描会重新图搜");
      await load(filter);
    } catch (e: any) {
      message.error("清除失败：" + (e?.message || String(e)));
    }
  }, [filter, load]);

  const lastScannedText = useMemo(() => {
    if (!snapshotId) return "（尚未扫描）";
    if (!rows.length) return snapshotId;
    const ts = rows[0]?.scanned_at;
    return ts ? new Date(ts).toLocaleString() : snapshotId;
  }, [snapshotId, rows]);

  const columns = useMemo(() => [
    {
      title: "主图",
      dataIndex: "main_image",
      width: 80,
      render: (url: string) => url ? <Image src={url} width={56} height={56} /> : <div style={{ width: 56, height: 56, background: "#f5f5f5" }} />,
    },
    {
      title: "商品",
      dataIndex: "title",
      render: (_: any, r: PriceReviewRow) => (
        <div>
          <div style={{ fontSize: 13 }}>{r.title || "-"}</div>
          <div style={{ fontSize: 11, color: "#999" }}>SPU {r.spu_id} / SKU {r.sku_id}</div>
          <div style={{ fontSize: 11, color: "#999" }}>{r.sku_spec}</div>
        </div>
      ),
    },
    {
      title: "卖家当前报价",
      dataIndex: "seller_current_price",
      width: 120,
      align: "right" as const,
      render: (v: number | null) => v != null ? `¥${v.toFixed(2)}` : "-",
      sorter: (a: PriceReviewRow, b: PriceReviewRow) => (a.seller_current_price || 0) - (b.seller_current_price || 0),
    },
    {
      title: <Tooltip title="1688 图搜同款价，手填值优先">1688 成本</Tooltip>,
      width: 140,
      align: "right" as const,
      render: (_: any, r: PriceReviewRow) => {
        const manual = r.cost_manual;
        const auto = r.cost_1688;
        const effective = manual != null ? manual : auto;
        if (effective == null) {
          return <Tag color="default">未知</Tag>;
        }
        return (
          <Space direction="vertical" size={0} style={{ alignItems: "flex-end" }}>
            <span>¥{effective.toFixed(2)}</span>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {manual != null ? "手填" : (r.cost_source === "yunqi_img_search" || r.cost_source === "1688_image_search") ? "云启图搜" : r.cost_source}
            </Text>
          </Space>
        );
      },
    },
    {
      title: `×${MARGIN_RATIO}`,
      width: 100,
      align: "right" as const,
      render: (_: any, r: PriceReviewRow) => {
        const effective = r.cost_manual != null ? r.cost_manual : r.cost_1688;
        if (effective == null) return "-";
        return `¥${(effective * MARGIN_RATIO).toFixed(2)}`;
      },
    },
    {
      title: "判定",
      dataIndex: "pass_175",
      width: 100,
      align: "center" as const,
      render: (v: number | null) => {
        if (v === 1) return <Tag icon={<CheckCircleTwoTone twoToneColor="#52c41a" />} color="success">通过</Tag>;
        if (v === 0) return <Tag icon={<CloseCircleTwoTone twoToneColor="#ff4d4f" />} color="error">不通过</Tag>;
        return <Tag icon={<QuestionCircleTwoTone twoToneColor="#d9d9d9" />} color="default">未知</Tag>;
      },
      filters: [
        { text: "通过", value: 1 },
        { text: "不通过", value: 0 },
        { text: "未知", value: null as any },
      ],
      onFilter: (val: any, r: PriceReviewRow) => r.pass_175 === val,
    },
    {
      title: "价差%",
      dataIndex: "price_diff_pct",
      width: 90,
      align: "right" as const,
      render: (v: number | null) => v != null ? `${v.toFixed(2)}%` : "-",
      sorter: (a: PriceReviewRow, b: PriceReviewRow) => (a.price_diff_pct || 0) - (b.price_diff_pct || 0),
    },
    {
      title: "参考价",
      dataIndex: "reference_price",
      width: 90,
      align: "right" as const,
      render: (v: number | null) => v != null ? `¥${v.toFixed(2)}` : "-",
    },
    {
      title: "操作",
      width: 200,
      fixed: "right" as const,
      render: (_: any, r: PriceReviewRow) => (
        <Space size="small">
          <Button size="small" onClick={() => setManualCostModal({ open: true, sku: r, value: r.cost_manual ?? r.cost_1688 ?? null })}>
            手填成本
          </Button>
          {r.cost_manual != null && (
            <Popconfirm title="清除手填成本？" onConfirm={() => handleClearManualCost(r.sku_id)}>
              <Button size="small" danger type="link">清除</Button>
            </Popconfirm>
          )}
          {r.detail_url && (
            <Tooltip title="跳转 Temu 后台核价页">
              <Button size="small" type="link" icon={<LinkOutlined />} onClick={() => window.open(r.detail_url, "_blank")} />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ], [handleClearManualCost]);

  return (
    <div style={{ padding: 16 }}>
      <Card style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <Statistic title="扫描总数" value={summary.total} />
          <Statistic title="通过" value={summary.pass} valueStyle={{ color: "#52c41a" }} />
          <Statistic title="不通过" value={summary.fail} valueStyle={{ color: "#ff4d4f" }} />
          <Statistic title="未知（无成本）" value={summary.unknown} valueStyle={{ color: "#8c8c8c" }} />
          <Statistic title="通过率" value={summary.total > 0 ? ((summary.pass / summary.total) * 100).toFixed(1) : 0} suffix="%" />
          <div style={{ paddingLeft: 16, borderLeft: "1px solid #f0f0f0" }}>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>最近扫描</div>
            <div style={{ fontSize: 13 }}>{lastScannedText}</div>
          </div>
          <Space direction="vertical" size={4} style={{ marginLeft: "auto" }}>
            <Space>
              <Button type="primary" icon={<SyncOutlined spin={scanning} />} loading={scanning} onClick={handleScanNow}>
                立即扫描
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => load(filter)}>刷新</Button>
              <Button onClick={handle1688Login}>1688 登录</Button>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              每 30 分钟自动扫描「价格申报中」的 SKU · 毛利阈值 ×{MARGIN_RATIO}
            </Text>
          </Space>
        </Space>
      </Card>

      <Card
        size="small"
        style={{ marginBottom: 12 }}
        styles={{ body: { padding: "8px 16px" } }}
      >
        <Space>
          <span>筛选：</span>
          <Radio.Group value={filter} onChange={(e) => { setFilter(e.target.value); load(e.target.value); }}>
            <Radio.Button value="all">全部</Radio.Button>
            <Radio.Button value="fail">不通过</Radio.Button>
            <Radio.Button value="pass">通过</Radio.Button>
            <Radio.Button value="unknown">未知</Radio.Button>
          </Radio.Group>
        </Space>
      </Card>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="当前为骨架版，核价页与 1688 图搜的 DOM 选择器尚未接入真实页面。首次运行后，请用实际页面的选择器替换 automation/price-review-scanner.mjs 与 automation/aliexpress-1688-cost.mjs 中标记 TODO 的位置。"
      />

      <Table
        rowKey="sku_id"
        columns={columns as any}
        dataSource={rows}
        loading={loading}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200] }}
        scroll={{ x: 1200 }}
        size="small"
      />

      <Modal
        title={`手填成本 - SKU ${manualCostModal.sku?.sku_id || ""}`}
        open={manualCostModal.open}
        onOk={handleSaveManualCost}
        onCancel={() => setManualCostModal({ open: false, sku: null, value: null })}
        okText="保存"
      >
        <p style={{ marginBottom: 8 }}>
          <Text type="secondary">手填值优先级高于 1688 图搜，清除前不会被覆盖。</Text>
        </p>
        <InputNumber
          value={manualCostModal.value ?? undefined}
          onChange={(v) => setManualCostModal((s) => ({ ...s, value: v == null ? null : Number(v) }))}
          min={0}
          step={0.01}
          prefix="¥"
          style={{ width: "100%" }}
          placeholder="填写实际进货成本（元）"
        />
      </Modal>
    </div>
  );
}
