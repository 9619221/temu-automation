import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Col, Empty, Modal, Row, Segmented, Space, Spin, Typography, message } from "antd";
import { SafetyCertificateOutlined, SaveOutlined } from "@ant-design/icons";
import type { PermissionAdminView, PermissionCatalogGroup } from "../utils/permissionCatalog";
import { PRIVILEGED_ROLES } from "../utils/permissionCatalog";

const { Text } = Typography;
const erp = window.electronAPI?.erp;

function allowKeysFor(view: PermissionAdminView | null, role: string, resourceType: string): string[] {
  if (!view) return [];
  return view.rolePermissions
    .filter((p) => p.role === role && p.resourceType === resourceType && p.accessLevel === "allow")
    .map((p) => p.resourceKey);
}

export default function RolePermissionPanel({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PermissionAdminView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<string>("operations");
  const [menuChecked, setMenuChecked] = useState<string[]>([]);
  const [actionChecked, setActionChecked] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!erp?.permission?.adminView) return;
    setLoading(true);
    try {
      const next = (await erp.permission.adminView({})) as PermissionAdminView;
      setView(next);
    } catch (error: any) {
      message.error(error?.message || "权限配置读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 仅在打开弹窗时拉取，避免没用到也请求。
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // 选中角色 / 数据变化时，从已加载的角色权限重算勾选。
  useEffect(() => {
    setMenuChecked(allowKeysFor(view, role, "menu"));
    setActionChecked(allowKeysFor(view, role, "action"));
  }, [view, role]);

  const roleOptions = useMemo(() => (
    (view?.catalog?.roles || [])
      .filter((r) => !r.privileged)
      .map((r) => ({ label: r.label, value: r.key }))
  ), [view]);

  const isPrivileged = PRIVILEGED_ROLES.has(role);
  const roleLabelText = view?.catalog?.roles.find((r) => r.key === role)?.label || role;

  const handleSave = async () => {
    if (!erp?.permission?.setRoleAccess) return;
    setSaving(true);
    try {
      await erp.permission.setRoleAccess({ role, resourceType: "menu", allowKeys: menuChecked });
      await erp.permission.setRoleAccess({ role, resourceType: "action", allowKeys: actionChecked });
      message.success(`「${roleLabelText}」权限已保存`);
      await load();
    } catch (error: any) {
      message.error(error?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const renderGroups = (
    groups: PermissionCatalogGroup[],
    checked: string[],
    setChecked: (next: string[]) => void,
  ) => (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      {groups.map((g) => (
        <div key={g.group}>
          <Text type="secondary" style={{ fontSize: 12 }}>{g.group}</Text>
          <div style={{ marginTop: 4 }}>
            <Checkbox.Group
              value={checked.filter((k) => g.items.some((i) => i.key === k))}
              options={g.items.map((i) => ({ label: i.label, value: i.key }))}
              onChange={(vals) => {
                const groupKeys = new Set(g.items.map((i) => i.key));
                const rest = checked.filter((k) => !groupKeys.has(k));
                setChecked([...rest, ...(vals as string[])]);
              }}
            />
          </div>
        </div>
      ))}
    </Space>
  );

  const columnTitle = (title: string, count: number) => (
    <div style={{ marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid var(--color-border, #f0f0f0)" }}>
      <Text strong>{title}</Text>
      <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>已选 {count} 项</Text>
    </div>
  );

  return (
    <div className="app-panel">
      <div className="app-panel__title">
        <div>
          <div className="app-panel__title-main">角色权限</div>
          <div className="app-panel__title-sub">按角色配置可访问的菜单与可执行的操作；管理员 / 负责人始终拥有全部权限。</div>
        </div>
        <Button type="primary" icon={<SafetyCertificateOutlined />} disabled={disabled} onClick={() => setOpen(true)}>
          配置角色权限
        </Button>
      </div>

      {disabled ? (
        <Alert type="warning" showIcon message="请先连接云端，再配置角色权限" />
      ) : null}

      <Modal
        open={open}
        title="角色权限配置"
        width={1040}
        onCancel={() => setOpen(false)}
        footer={[<Button key="close" onClick={() => setOpen(false)}>关闭</Button>]}
        destroyOnClose
      >
        <Spin spinning={loading}>
          {roleOptions.length === 0 && !loading ? (
            <Empty description="暂无可配置角色" />
          ) : (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Segmented block value={role} onChange={(v) => setRole(String(v))} options={roleOptions} />

              {isPrivileged ? (
                <Alert type="info" showIcon message="该角色拥有全部权限，无需配置。" />
              ) : (
                <>
                  {view ? (
                    <Row gutter={32}>
                      <Col span={12}>
                        {columnTitle("可访问菜单", menuChecked.length)}
                        {renderGroups(view.catalog.menus, menuChecked, setMenuChecked)}
                      </Col>
                      <Col span={12}>
                        {columnTitle("可执行操作", actionChecked.length)}
                        {renderGroups(view.catalog.actions, actionChecked, setActionChecked)}
                      </Col>
                    </Row>
                  ) : null}
                  <Button type="primary" icon={<SaveOutlined />} block loading={saving} onClick={handleSave}>
                    保存「{roleLabelText}」权限
                  </Button>
                </>
              )}
            </Space>
          )}
        </Spin>
      </Modal>
    </div>
  );
}
