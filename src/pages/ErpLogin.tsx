import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Card, Form, Input, Select, Space, Typography, message } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { getDefaultPathForRole } from "../utils/erpRoleAccess";

const { Text } = Typography;
const LOGIN_MESSAGE_KEY = "temu-login-message";
const TEAM_WORKSPACE_PORT = 19380;

const loginShellStyle: CSSProperties = {
  position: "relative",
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: 24,
  overflow: "hidden",
  background: "#f4f7fb",
};

const loginBaseLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: [
    "linear-gradient(135deg, rgba(229,91,0,0.10) 0%, rgba(229,91,0,0.00) 32%)",
    "linear-gradient(225deg, rgba(22,119,255,0.13) 0%, rgba(22,119,255,0.00) 42%)",
    "linear-gradient(180deg, #fbfcff 0%, #eef3f8 100%)",
  ].join(", "),
};

const loginGridLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0.52,
  backgroundImage: [
    "linear-gradient(rgba(31,41,55,0.055) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(31,41,55,0.055) 1px, transparent 1px)",
  ].join(", "),
  backgroundSize: "64px 64px",
  maskImage: "linear-gradient(180deg, rgba(0,0,0,0.92), rgba(0,0,0,0.28))",
};

const loginBandLayerStyle: CSSProperties = {
  position: "absolute",
  inset: "-18% -10%",
  opacity: 0.62,
  transform: "rotate(-7deg)",
  background: [
    "linear-gradient(90deg, transparent 0 16%, rgba(255,255,255,0.74) 16% 24%, transparent 24% 100%)",
    "linear-gradient(90deg, transparent 0 58%, rgba(47,144,127,0.10) 58% 63%, transparent 63% 100%)",
    "linear-gradient(90deg, transparent 0 72%, rgba(22,119,255,0.10) 72% 78%, transparent 78% 100%)",
  ].join(", "),
};

const loginPanelLayerStyle: CSSProperties = {
  position: "absolute",
  width: "min(74vw, 920px)",
  height: 300,
  left: "9%",
  top: "17%",
  border: "1px solid rgba(84, 103, 135, 0.10)",
  borderRadius: 18,
  background: "linear-gradient(135deg, rgba(255,255,255,0.54), rgba(255,255,255,0.12))",
  boxShadow: "0 28px 90px rgba(28, 43, 71, 0.08)",
};

const loginCardStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  width: "min(100%, 420px)",
  borderRadius: 12,
  border: "1px solid rgba(255, 255, 255, 0.92)",
  boxShadow: "0 24px 70px rgba(31, 41, 55, 0.16)",
  overflow: "hidden",
  backdropFilter: "blur(10px)",
};

export default function ErpLogin() {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const auth = useErpAuth();
  const [submitting, setSubmitting] = useState(false);
  const [checkingWorkspace, setCheckingWorkspace] = useState(false);
  const [workspaces, setWorkspaces] = useState<Array<{ url: string; name?: string }>>([]);
  const [selectedWorkspaceUrl, setSelectedWorkspaceUrl] = useState("");
  const submittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      if (auth.loading) return;
      setCheckingWorkspace(true);
      try {
        const status = await window.electronAPI?.erp?.client?.getStatus?.();
        if (cancelled) return;
        if (status?.serverUrl) {
          setSelectedWorkspaceUrl(status.serverUrl);
          setWorkspaces([{ url: status.serverUrl, name: undefined }]);
          return;
        }

        if (status?.mode === "host" || status?.dbInitialized || auth.hasUsers) {
          setSelectedWorkspaceUrl("");
          setWorkspaces([]);
          return;
        }

        const found = await window.electronAPI?.erp?.client?.discover?.({
          port: TEAM_WORKSPACE_PORT,
          timeoutMs: 650,
        });
        if (cancelled) return;
        const nextWorkspaces = (found || []).map((item: any) => ({
          url: item.url,
          name: item.name,
        }));
        setWorkspaces(nextWorkspaces);
        setSelectedWorkspaceUrl(nextWorkspaces[0]?.url || "");
      } catch {
        if (!cancelled) {
          setWorkspaces([]);
          setSelectedWorkspaceUrl("");
        }
      } finally {
        if (!cancelled) setCheckingWorkspace(false);
      }
    }
    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [auth.hasUsers, auth.loading]);

  useEffect(() => {
    if (auth.currentUser) {
      navigate(getDefaultPathForRole(auth.currentUser.role), { replace: true });
    }
  }, [auth.currentUser, navigate]);

  const handleSubmit = async (values: { login?: string; accessCode: string }) => {
    if (submittingRef.current || submitting || auth.loading || checkingWorkspace) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const nextStatus = selectedWorkspaceUrl
        ? await auth.login({
          login: values.login || "",
          accessCode: values.accessCode,
          serverUrl: selectedWorkspaceUrl,
        })
        : await auth.login({
          login: values.login || "",
          accessCode: values.accessCode,
        });
      const user = nextStatus.currentUser;
      message.success({
        key: LOGIN_MESSAGE_KEY,
        content: "登录成功",
      });
      navigate(getDefaultPathForRole(user?.role), { replace: true });
    } catch (error: any) {
      message.error({
        key: LOGIN_MESSAGE_KEY,
        content: error?.message || "登录失败",
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div style={loginShellStyle}>
      <div aria-hidden="true" style={loginBaseLayerStyle} />
      <div aria-hidden="true" style={loginGridLayerStyle} />
      <div aria-hidden="true" style={loginBandLayerStyle} />
      <div aria-hidden="true" style={loginPanelLayerStyle} />
      <Card
        title="登录 Temu 自动化运营工具"
        style={loginCardStyle}
        styles={{
          header: {
            borderBottomColor: "rgba(230, 232, 239, 0.82)",
            background: "rgba(255,255,255,0.88)",
          },
          body: {
            paddingTop: 18,
            background: "rgba(255,255,255,0.82)",
          },
        }}
      >
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          <Text type="secondary">
            输入管理员分配的账号和访问码，系统会按角色进入对应工作台。
          </Text>
          <Form form={form} layout="vertical" onFinish={handleSubmit}>
            {workspaces.length > 1 ? (
              <Form.Item label="工作空间">
                <Select
                  value={selectedWorkspaceUrl}
                  options={workspaces.map((item, index) => ({
                    label: item.name || `工作空间 ${index + 1}`,
                    value: item.url,
                  }))}
                  onChange={setSelectedWorkspaceUrl}
                />
              </Form.Item>
            ) : null}
            <Form.Item
              name="login"
              label="用户"
              rules={[{ required: true, message: "请输入用户名" }]}
            >
              <Input prefix={<UserOutlined />} placeholder="用户名或用户 ID" autoFocus />
            </Form.Item>
            <Form.Item
              name="accessCode"
              label="访问码"
              rules={[{ required: true, message: "请输入访问码" }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="访问码" />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={submitting || auth.loading || checkingWorkspace}
            >
              登录
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
