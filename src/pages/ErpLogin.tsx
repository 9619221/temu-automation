import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Card, Form, Input, Space, Typography, message } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { getDefaultPathForRole } from "../utils/erpRoleAccess";
import { ERP_CLOUD_SERVER_URL } from "../config/erpCloud";

const { Text } = Typography;
const LOGIN_MESSAGE_KEY = "temu-login-message";

const loginShellStyle: CSSProperties = {
  position: "relative",
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: 24,
  overflow: "hidden",
  background: "var(--color-bg)",
};

const loginBaseLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: [
    "linear-gradient(135deg, rgba(229,91,0,0.10) 0%, rgba(229,91,0,0.00) 30%)",
    "linear-gradient(225deg, rgba(37,99,235,0.10) 0%, rgba(37,99,235,0.00) 44%)",
    "linear-gradient(180deg, #f8fafc 0%, #eef2f6 100%)",
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
  opacity: 0.44,
  transform: "rotate(-7deg)",
  background: [
    "linear-gradient(90deg, transparent 0 16%, rgba(255,255,255,0.72) 16% 24%, transparent 24% 100%)",
    "linear-gradient(90deg, transparent 0 58%, rgba(15,118,110,0.08) 58% 63%, transparent 63% 100%)",
    "linear-gradient(90deg, transparent 0 72%, rgba(37,99,235,0.08) 72% 78%, transparent 78% 100%)",
  ].join(", "),
};

const loginPanelLayerStyle: CSSProperties = {
  position: "absolute",
  width: "min(74vw, 920px)",
  height: 300,
  left: "9%",
  top: "17%",
  border: "1px solid rgba(84, 103, 135, 0.10)",
  borderRadius: 8,
  background: "linear-gradient(135deg, rgba(255,255,255,0.58), rgba(255,255,255,0.18))",
  boxShadow: "0 28px 90px rgba(28, 43, 71, 0.08)",
};

const loginCardStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  width: "min(100%, 420px)",
  borderRadius: 8,
  border: "1px solid rgba(255, 255, 255, 0.92)",
  boxShadow: "0 24px 70px rgba(16, 24, 40, 0.14)",
  overflow: "hidden",
  backdropFilter: "blur(10px)",
};

export default function ErpLogin() {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const auth = useErpAuth();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (auth.currentUser) {
      navigate(getDefaultPathForRole(auth.currentUser.role), { replace: true });
    }
  }, [auth.currentUser, navigate]);

  const handleSubmit = async (values: { login?: string; accessCode: string }) => {
    if (submittingRef.current || submitting || auth.loading) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const runtime = await window.electronAPI?.erp?.client?.getStatus?.().catch(() => null);
      const loginPayload: { login: string; accessCode: string; serverUrl?: string } = {
        login: values.login || "",
        accessCode: values.accessCode,
      };
      loginPayload.serverUrl = runtime?.isClientMode
        ? runtime.serverUrl || ERP_CLOUD_SERVER_URL
        : ERP_CLOUD_SERVER_URL;
      const nextStatus = await auth.login(loginPayload);
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
            输入管理员分配的用户名和访问码登录 ERP。
          </Text>
          <Form form={form} layout="vertical" onFinish={handleSubmit}>
            <Form.Item
              name="login"
              label="用户"
              rules={[{ required: true, message: "请输入用户名" }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="例如 zhangsan…"
                autoComplete="username"
                spellCheck={false}
              />
            </Form.Item>
            <Form.Item
              name="accessCode"
              label="访问码"
              rules={[{ required: true, message: "请输入访问码" }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="输入访问码…"
                autoComplete="current-password"
                spellCheck={false}
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={submitting || auth.loading}
            >
              登录
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
