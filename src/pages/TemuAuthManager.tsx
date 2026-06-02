import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CloudDownloadOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { canRole } from "../utils/erpUi";

const erp = window.electronAPI?.erp;

interface TemuOpenApiBinding {
  mallId: string;
  mallName: string;
  region: string;
  appKey?: string;
  authorized: boolean;
  semiManaged?: boolean;
  scopeCount: number;
  accessTokenExpiresAt: string;
  status: string;
  authorizedAt?: string;
  updatedAt?: string;
  productSyncCount?: number;
  lastProductSyncAt?: string;
  lastProductSyncStatus?: string;
  lastProductSyncError?: string;
  lastRecordsSyncAt?: string;
  lastRecordsSyncStatus?: string;
  lastRecordsSyncError?: string;
  recordsSyncSummary?: Record<string, number>;
}

const REGION_OPTIONS = [
  { value: "CN", label: "CN（全托/半托发品·库存·全托备货履约）" },
  { value: "PA", label: "PA（半托库存·调价核价）" },
  { value: "US", label: "US（美国半托履约）" },
  { value: "EU", label: "EU（欧区半托履约）" },
  { value: "GLOBAL", label: "GLOBAL（合规资质·全球半托履约）" },
];

export default function TemuAuthManager() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role;
  const canManage = canRole(role, ["admin", "manager"]);

  const [bindings, setBindings] = useState<TemuOpenApiBinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [form] = Form.useForm<{ accessToken: string; region: string; mallName?: string }>();

  const load = useCallback(async () => {
    if (!erp?.temuOpenApi) return;
    setLoading(true);
    try {
      const res = await erp.temuOpenApi.list();
      setBindings(Array.isArray(res?.malls) ? res.malls : []);
    } catch (error: any) {
      message.error(error?.message || "读取授权列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openBindModal = () => {
    form.resetFields();
    form.setFieldsValue({ region: "CN" });
    setModalOpen(true);
  };

  const handleBind = async () => {
    if (!erp?.temuOpenApi) {
      message.error("当前运行的应用未加载该功能，请完全重启应用（改了 preload，需重启 Electron 而非热更新才生效）");
      return;
    }
    const values = await form.validateFields();
    setSubmitting("bind");
    try {
      const binding = await erp.temuOpenApi.bind({
        accessToken: values.accessToken.trim(),
        region: values.region || "CN",
        mallName: values.mallName?.trim() || undefined,
      });
      message.success(`已绑定店铺 ${binding.mallName || binding.mallId}（${binding.scopeCount} 个接口权限）`);
      setModalOpen(false);
      form.resetFields();
      await load();
    } catch (error: any) {
      message.error(error?.message || "绑定失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleUnbind = async (row: TemuOpenApiBinding) => {
    if (!erp?.temuOpenApi) {
      message.error("当前运行的应用未加载该功能，请完全重启应用");
      return;
    }
    setSubmitting(`unbind:${row.mallId}`);
    try {
      await erp.temuOpenApi.unbind({ mallId: row.mallId });
      message.success("已解绑");
      await load();
    } catch (error: any) {
      message.error(error?.message || "解绑失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleSyncProducts = async (row?: TemuOpenApiBinding) => {
    if (!erp?.temuOpenApi) {
      message.error("当前运行的应用未加载该功能，请完全重启应用");
      return;
    }
    const key = row ? `sync:${row.mallId}` : "sync:all";
    setSubmitting(key);
    try {
      const res: any = await erp.temuOpenApi.syncProducts(row ? { mallId: row.mallId } : {});
      if (res?.started === false && res?.running) {
        message.info(res.message || "该采集任务正在进行中，请稍候");
      } else {
        message.success("采集已在后台开始（约 1 分钟），完成后自动刷新查看");
        // 采集在服务器后台跑，延迟几次刷新拉取最新采集状态
        [15000, 35000, 65000].forEach((ms) => setTimeout(() => { void load(); }, ms));
      }
    } catch (error: any) {
      message.error(error?.message || "采集触发失败");
    } finally {
      setSubmitting(null);
    }
  };

  const columns: ColumnsType<TemuOpenApiBinding> = [
    {
      title: "店铺",
      key: "mall",
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <span>{row.mallName || row.mallId}</span>
          <span style={{ color: "#667085", fontSize: 12 }}>mallId: {row.mallId}</span>
        </Space>
      ),
    },
    {
      title: "分区",
      dataIndex: "region",
      key: "region",
      width: 90,
      render: (value, row) => (
        <Space size={4}>
          <Tag>{value}</Tag>
          {row.semiManaged ? <Tag color="geekblue">半托</Tag> : <Tag color="gold">全托</Tag>}
        </Space>
      ),
    },
    {
      title: "授权状态",
      key: "authorized",
      width: 110,
      render: (_value, row) => (
        row.authorized
          ? <Tag color="success">已授权</Tag>
          : <Tag color="error">{row.status === "revoked" ? "已解绑" : "失效"}</Tag>
      ),
    },
    {
      title: "接口权限",
      dataIndex: "scopeCount",
      key: "scopeCount",
      width: 100,
      render: (value) => `${value || 0} 个`,
    },
    {
      title: "Token 到期",
      dataIndex: "accessTokenExpiresAt",
      key: "expiry",
      width: 180,
      render: (value) => (value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-"),
    },
    {
      title: "商品采集",
      key: "productSync",
      width: 200,
      render: (_value, row) => {
        if (!row.lastProductSyncAt) {
          return <span style={{ color: "#98a2b3" }}>未采集</span>;
        }
        const time = new Date(row.lastProductSyncAt).toLocaleString("zh-CN", { hour12: false });
        return (
          <Space direction="vertical" size={0}>
            <Space size={4}>
              <span>{row.productSyncCount || 0} 商品</span>
              {row.lastProductSyncStatus === "error" ? (
                <Tooltip title={row.lastProductSyncError || "采集失败"}>
                  <Tag color="error">失败</Tag>
                </Tooltip>
              ) : null}
            </Space>
            <span style={{ color: "#667085", fontSize: 12 }}>{time}</span>
          </Space>
        );
      },
    },
    {
      title: "多源采集",
      key: "recordsSync",
      width: 230,
      render: (_value, row) => {
        const sum = row.recordsSyncSummary || {};
        if (!row.lastRecordsSyncAt) return <span style={{ color: "#98a2b3" }}>未采集</span>;
        const labels: Record<string, string> = {
          purchase_order: "采购", ship_order: "发货", sales: "销售", return: "售后", inventory: "库存",
        };
        const parts = Object.keys(labels)
          .filter((k) => sum[k] !== undefined)
          .map((k) => `${labels[k]}${sum[k] < 0 ? "✕" : sum[k]}`);
        return (
          <Space direction="vertical" size={0}>
            <Space size={4} wrap>
              <span style={{ fontSize: 12 }}>{parts.join(" · ")}</span>
              {row.lastRecordsSyncStatus === "partial" ? (
                <Tooltip title={row.lastRecordsSyncError || "部分源采集失败"}>
                  <Tag color="warning">部分失败</Tag>
                </Tooltip>
              ) : null}
            </Space>
            <span style={{ color: "#667085", fontSize: 12 }}>
              {new Date(row.lastRecordsSyncAt).toLocaleString("zh-CN", { hour12: false })}
            </span>
          </Space>
        );
      },
    },
    ...(canManage ? [{
      title: "操作",
      key: "actions",
      width: 270,
      render: (_value: unknown, row: TemuOpenApiBinding) => (
        <Space size={6}>
          <Button
            size="small"
            type="primary"
            loading={submitting === `sync:${row.mallId}`}
            onClick={() => handleSyncProducts(row)}
          >
            立即采集
          </Button>
          <Button
            size="small"
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ region: row.region, mallName: row.mallName });
              setModalOpen(true);
            }}
          >
            重新绑定
          </Button>
          <Popconfirm
            title="解绑授权"
            description="解绑后将清除该店铺的 access_token，官方接口调用会停用。"
            okText="解绑"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleUnbind(row)}
          >
            <Button danger size="small" type="text" loading={submitting === `unbind:${row.mallId}`}>
              解绑
            </Button>
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  if (!erp) {
    return <Alert type="error" showIcon message="当前环境缺少本地服务接口" style={{ margin: 16 }} />;
  }

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={(
          <Space direction="vertical" size={2}>
            <span>Temu 官方接口授权</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              商家在卖家中心「授权管理」勾选「云舵AI」后复制 access_token 填入即可。App Key / App Secret 由系统默认配置，无需填写。
            </Typography.Text>
          </Space>
        )}
        extra={(
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            {canManage && bindings.length > 0 ? (
              <Button
                icon={<CloudDownloadOutlined />}
                loading={submitting === "sync:all"}
                onClick={() => handleSyncProducts()}
              >
                全部采集商品
              </Button>
            ) : null}
            {canManage ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openBindModal}>
                绑定授权
              </Button>
            ) : null}
          </Space>
        )}
      >
        {!canManage ? (
          <Alert type="info" showIcon message="当前角色仅可查看授权列表。" style={{ marginBottom: 12 }} />
        ) : null}
        <Table
          size="small"
          rowKey="mallId"
          loading={loading}
          columns={columns}
          dataSource={bindings}
          pagination={false}
          locale={{ emptyText: "尚未绑定任何店铺的官方授权" }}
        />
      </Card>

      <Modal
        title="绑定 Temu 官方接口授权"
        open={modalOpen}
        okText="校验并绑定"
        cancelText="取消"
        confirmLoading={submitting === "bind"}
        onOk={handleBind}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="如何获取 access_token"
          description="卖家中心 → 授权管理 → 选择应用「云舵AI」→ 勾选接口（建议全选）→ 确认 → 复制 token。App Key / App Secret 由系统默认配置，无需填写。"
        />
        <Form form={form} layout="vertical">
          <Form.Item name="accessToken" label="access_token" rules={[{ required: true, message: "请粘贴 access_token" }]}>
            <Input.TextArea rows={3} placeholder="粘贴商家授权后复制的 access_token" />
          </Form.Item>
          <Form.Item name="region" label="分区" initialValue="CN" rules={[{ required: true, message: "请选择分区" }]} tooltip="必须与获取 token 的卖家中心同区，默认 CN">
            <Select options={REGION_OPTIONS} />
          </Form.Item>
          <Form.Item name="mallName" label="店铺名称（可选）">
            <Input placeholder="便于识别，可留空（系统会尽量自动带出）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
