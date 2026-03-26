import { useState, useEffect } from "react";
import {
  Tabs, Card, Form, Input, InputNumber, Button, Space, Table, Tag,
  message, Progress, Checkbox, Upload, Empty, Tooltip, Badge, Row, Col, Statistic,
} from "antd";
import {
  PlusOutlined, RocketOutlined, FileExcelOutlined, HistoryOutlined,
  PictureOutlined, DeleteOutlined, ReloadOutlined, CheckCircleOutlined,
  CloseCircleOutlined, LoadingOutlined, CloudUploadOutlined,
} from "@ant-design/icons";

const { TextArea } = Input;
const api = (window as any).electronAPI?.automation;
const store = (window as any).electronAPI?.store;

// ========== Tab 1: 单个上品 ==========
function SingleCreate() {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [aiTypes, setAiTypes] = useState<string[]>(["hero", "lifestyle", "closeup"]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      setResult(null);

      const params: any = {
        title: values.title,
        categorySearch: values.title,
        price: values.price,
        generateAI: true,
        aiImageTypes: aiTypes,
        autoSubmit: false,
        keepOpen: true,
      };

      if (values.sourceImage) {
        params.sourceImage = values.sourceImage;
      }

      const res = await api?.createProduct(params);
      setResult(res);

      if (res?.success) {
        message.success("上品成功！请在浏览器中检查并提交");
        // Save to history
        const history = (await store?.get("temu_create_history")) || [];
        history.unshift({
          title: values.title,
          price: values.price,
          status: "draft",
          createdAt: Date.now(),
          result: res,
        });
        await store?.set("temu_create_history", history.slice(0, 100));
      } else {
        message.error(res?.message || "上品失败");
      }
    } catch (e: any) {
      message.error(e.message || "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card
        title={<span><PlusOutlined style={{ color: "#e55b00", marginRight: 8 }} />商品信息</span>}
        style={{ borderRadius: 12 }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="商品标题（英文）" rules={[{ required: true, message: "请输入标题" }]}>
            <TextArea rows={3} placeholder="输入商品标题，系统会根据标题自动匹配分类" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="price" label="申报价格 (¥)" rules={[{ required: true, message: "请输入价格" }]}>
                <InputNumber min={0.01} step={0.1} style={{ width: "100%" }} placeholder="30.00" />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="sourceImage" label="参考图片路径（可选，用于AI生成）">
                <Input placeholder="C:/images/product.jpg 或留空使用AI纯生成" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card
        title={<span><PictureOutlined style={{ color: "#1890ff", marginRight: 8 }} />AI 图片生成</span>}
        style={{ borderRadius: 12 }}
      >
        <div style={{ marginBottom: 16 }}>
          <span style={{ marginRight: 12, fontWeight: 500 }}>生成类型：</span>
          <Checkbox.Group
            value={aiTypes}
            onChange={(v) => setAiTypes(v as string[])}
            options={[
              { label: "🎯 主图 (Hero)", value: "hero" },
              { label: "🏠 场景图 (Lifestyle)", value: "lifestyle" },
              { label: "🔍 细节图 (Closeup)", value: "closeup" },
            ]}
          />
        </div>
        <div style={{ color: "#999", fontSize: 13 }}>
          AI 将根据商品标题自动生成对应类型的商品图片，并上传到 Temu 素材中心
        </div>
      </Card>

      <Card style={{ borderRadius: 12 }}>
        <Space>
          <Button
            type="primary"
            icon={<RocketOutlined />}
            size="large"
            loading={submitting}
            onClick={handleSubmit}
            style={{ background: "#e55b00", borderColor: "#e55b00", height: 48, paddingInline: 32, fontSize: 16 }}
          >
            {submitting ? "上品中..." : "开始上品"}
          </Button>
          <Button size="large" onClick={() => form.resetFields()}>
            重置
          </Button>
        </Space>

        {result && (
          <div style={{ marginTop: 16, padding: 12, background: result.success ? "#f6ffed" : "#fff2f0", borderRadius: 8 }}>
            <Tag color={result.success ? "success" : "error"} style={{ fontSize: 14, padding: "4px 12px" }}>
              {result.success ? "✅ 上品成功" : "❌ 上品失败"}
            </Tag>
            <span style={{ marginLeft: 8, color: "#666" }}>{result.message}</span>
          </div>
        )}
      </Card>
    </Space>
  );
}

// ========== Tab 2: CSV 批量上品 ==========
function BatchCreate() {
  const [csvPath, setCsvPath] = useState("");
  const [preview, setPreview] = useState<any[]>([]);
  const [startRow, setStartRow] = useState(0);
  const [count, setCount] = useState(3);
  const [aiTypes, setAiTypes] = useState<string[]>(["hero"]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);

  const loadPreview = async () => {
    if (!csvPath) return;
    try {
      // Read CSV via store
      const data = await api?.readScrapeData?.("csv_preview:" + csvPath);
      if (data?.rows) {
        setPreview(data.rows.slice(0, 20));
        message.success(`已加载 ${data.rows.length} 行数据`);
      } else {
        message.info("无法预览CSV，但可以直接使用");
      }
    } catch {
      message.info("CSV路径已设置，点击开始批量上品");
    }
  };

  const handleBatch = async () => {
    if (!csvPath) {
      message.warning("请输入CSV文件路径");
      return;
    }
    setRunning(true);
    setResult(null);
    setProgress([]);

    try {
      const res = await api?.batchCreateFromCsv({
        csvPath,
        startRow,
        count,
        generateAI: true,
        aiImageTypes: aiTypes,
        autoSubmit: false,
      });
      setResult(res);

      if (res?.results) {
        setProgress(res.results);
      }

      const successCount = res?.results?.filter((r: any) => r.success).length || 0;
      if (successCount > 0) {
        message.success(`批量上品完成：${successCount}/${count} 成功`);
      } else {
        message.error("批量上品失败");
      }

      // Save to history
      const history = (await store?.get("temu_create_history")) || [];
      (res?.results || []).forEach((r: any) => {
        history.unshift({
          title: r.title || `CSV Row ${r.row}`,
          price: r.price,
          status: r.success ? "draft" : "failed",
          createdAt: Date.now(),
          result: r,
        });
      });
      await store?.set("temu_create_history", history.slice(0, 100));
    } catch (e: any) {
      message.error(e.message || "批量操作失败");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card
        title={<span><FileExcelOutlined style={{ color: "#00b96b", marginRight: 8 }} />CSV 文件配置</span>}
        style={{ borderRadius: 12 }}
      >
        <Form layout="vertical">
          <Form.Item label="CSV 文件路径">
            <Space.Compact style={{ width: "100%" }}>
              <Input
                value={csvPath}
                onChange={(e) => setCsvPath(e.target.value)}
                placeholder="C:/Users/Administrator/Desktop/五金.csv"
                style={{ flex: 1 }}
              />
              <Button onClick={loadPreview}>预览</Button>
            </Space.Compact>
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="起始行（从0开始）">
                <InputNumber min={0} value={startRow} onChange={(v) => setStartRow(v || 0)} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="上品数量">
                <InputNumber min={1} max={50} value={count} onChange={(v) => setCount(v || 1)} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="AI 图片类型">
                <Checkbox.Group
                  value={aiTypes}
                  onChange={(v) => setAiTypes(v as string[])}
                  options={[
                    { label: "主图", value: "hero" },
                    { label: "场景", value: "lifestyle" },
                    { label: "细节", value: "closeup" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card style={{ borderRadius: 12 }}>
        <Space>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            size="large"
            loading={running}
            onClick={handleBatch}
            style={{ background: "#00b96b", borderColor: "#00b96b", height: 48, paddingInline: 32, fontSize: 16 }}
          >
            {running ? "批量上品中..." : `开始批量上品 (${count}个)`}
          </Button>
        </Space>

        {running && (
          <div style={{ marginTop: 16 }}>
            <Progress percent={Math.round((progress.length / count) * 100)} status="active" />
          </div>
        )}

        {result?.results && (
          <div style={{ marginTop: 16 }}>
            <Table
              dataSource={result.results.map((r: any, i: number) => ({ key: i, ...r }))}
              columns={[
                { title: "#", key: "idx", width: 50, render: (_: any, __: any, i: number) => i + 1 },
                {
                  title: "商品", dataIndex: "title", key: "title", ellipsis: true,
                  render: (v: string) => <span style={{ fontSize: 13 }}>{(v || "").slice(0, 50)}</span>,
                },
                {
                  title: "状态", dataIndex: "success", key: "status", width: 100,
                  render: (v: boolean) => (
                    <Tag color={v ? "success" : "error"} icon={v ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
                      {v ? "成功" : "失败"}
                    </Tag>
                  ),
                },
                {
                  title: "耗时", dataIndex: "duration", key: "dur", width: 80,
                  render: (v: number) => v ? `${Math.round(v)}s` : "-",
                },
              ]}
              pagination={false}
              size="small"
              bordered={false}
            />
          </div>
        )}
      </Card>
    </Space>
  );
}

// ========== Tab 3: 上品记录 ==========
function CreateHistory() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = async () => {
    setLoading(true);
    const data = (await store?.get("temu_create_history")) || [];
    setHistory(data);
    setLoading(false);
  };

  useEffect(() => { loadHistory(); }, []);

  const statusMap: Record<string, { color: string; text: string }> = {
    draft: { color: "processing", text: "草稿" },
    submitted: { color: "warning", text: "已提交" },
    reviewing: { color: "blue", text: "核价中" },
    approved: { color: "success", text: "已通过" },
    rejected: { color: "error", text: "被驳回" },
    failed: { color: "default", text: "失败" },
  };

  return (
    <Card style={{ borderRadius: 12 }}>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Space>
          <Statistic title="总计" value={history.length} valueStyle={{ fontSize: 20 }} />
          <Statistic title="成功" value={history.filter(h => h.status !== "failed").length} valueStyle={{ fontSize: 20, color: "#00b96b" }} />
          <Statistic title="失败" value={history.filter(h => h.status === "failed").length} valueStyle={{ fontSize: 20, color: "#ff4d4f" }} />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={loadHistory}>刷新</Button>
      </div>

      {history.length === 0 ? (
        <Empty description="暂无上品记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          loading={loading}
          dataSource={history.map((h, i) => ({ key: i, ...h }))}
          columns={[
            {
              title: "商品标题", dataIndex: "title", key: "title", ellipsis: true,
              render: (v: string) => <span style={{ fontSize: 13 }}>{(v || "").slice(0, 60)}</span>,
            },
            {
              title: "价格", dataIndex: "price", key: "price", width: 90,
              render: (v: number) => v ? `¥${v}` : "-",
            },
            {
              title: "状态", dataIndex: "status", key: "status", width: 90,
              render: (v: string) => {
                const s = statusMap[v] || { color: "default", text: v };
                return <Tag color={s.color}>{s.text}</Tag>;
              },
            },
            {
              title: "时间", dataIndex: "createdAt", key: "time", width: 160,
              render: (v: number) => v ? new Date(v).toLocaleString("zh-CN") : "-",
            },
          ]}
          pagination={{ pageSize: 10 }}
          size="small"
          bordered={false}
        />
      )}
    </Card>
  );
}

// ========== 主页面 ==========
export default function ProductCreate() {
  return (
    <div style={{ maxWidth: 1000 }}>
      <Tabs
        defaultActiveKey="single"
        type="card"
        items={[
          {
            key: "single",
            label: (
              <span><PlusOutlined style={{ marginRight: 4 }} />单个上品</span>
            ),
            children: <SingleCreate />,
          },
          {
            key: "batch",
            label: (
              <span><FileExcelOutlined style={{ marginRight: 4 }} />CSV 批量上品</span>
            ),
            children: <BatchCreate />,
          },
          {
            key: "history",
            label: (
              <span><HistoryOutlined style={{ marginRight: 4 }} />上品记录</span>
            ),
            children: <CreateHistory />,
          },
        ]}
      />
    </div>
  );
}
