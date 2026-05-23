import { useEffect, useRef, useState } from "react";
import { Button, Form, Input, message } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { getDefaultPathForRole } from "../utils/erpRoleAccess";
import { ERP_CLOUD_SERVER_URL } from "../config/erpCloud";

const LOGIN_MESSAGE_KEY = "temu-login-message";

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
    <div className="erp-login-shell">
      <main className="erp-login-panel" aria-labelledby="erp-login-title">
        <BrandMark size={54} className="erp-login-mark" />
        <h1 id="erp-login-title">Temu Ops</h1>
        <p>使用账号和访问码进入运营中台。</p>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
          className="erp-login-form"
        >
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
            className="erp-login-submit"
          >
            登录
          </Button>
        </Form>
      </main>
    </div>
  );
}
