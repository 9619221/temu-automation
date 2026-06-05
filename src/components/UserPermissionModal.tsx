import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Col, Modal, Row, Segmented, Select, Space, Spin, Tag, Typography, message } from "antd";
import type { MallDictItem, PermissionAdminView, PermissionCatalogGroup } from "../utils/permissionCatalog";
import { PRIVILEGED_ROLES, formatStoreLabel } from "../utils/permissionCatalog";

const { Text } = Typography;
const erp = window.electronAPI?.erp;

interface TargetUser {
  id: string;
  name: string;
  role: string;
}

export default function UserPermissionModal({
  open,
  user,
  onClose,
}: {
  open: boolean;
  user: TargetUser | null;
  onClose: (changed?: boolean) => void;
}) {
  const [view, setView] = useState<PermissionAdminView | null>(null);
  const [malls, setMalls] = useState<MallDictItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedMalls, setSelectedMalls] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, "allow" | "deny">>({});

  const privileged = user ? PRIVILEGED_ROLES.has(user.role) : false;

  const load = useCallback(async () => {
    if (!open || !user || !erp?.permission?.adminView) return;
    setLoading(true);
    try {
      const [v, mallResp] = await Promise.all([
        erp.permission.adminView({ userId: user.id }) as Promise<PermissionAdminView>,
        erp.reports?.mallDict ? erp.reports.mallDict() : Promise.resolve(null),
      ]);
      setView(v);
      setMalls((mallResp?.data?.malls || []) as MallDictItem[]);
      const scopes = v?.user?.scopes || [];
      setSelectedMalls(scopes.filter((s) => s.resourceType === "mall").map((s) => s.resourceId));
      const map: Record<string, "allow" | "deny"> = {};
      for (const o of v?.user?.overrides || []) {
        if (o.accessLevel === "allow" || o.accessLevel === "deny") {
          map[`${o.resourceType}|${o.resourceKey}`] = o.accessLevel;
        }
      }
      setOverrides(map);
    } catch (error: any) {
      message.error(error?.message || "用户权限读取失败");
    } finally {
      setLoading(false);
    }
  }, [open, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const roleAllow = useMemo(() => {
    const set = new Set<string>();
    if (view && user) {
      for (const p of view.rolePermissions) {
        if (p.role === user.role && p.accessLevel === "allow") set.add(`${p.resourceType}|${p.resourceKey}`);
      }
    }
    return set;
  }, [view, user]);

  const isDefaultAllowed = (type: string, key: string) => privileged || roleAllow.has(`${type}|${key}`);

  const updateOverride = (ck: string, v: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (v === "allow" || v === "deny") next[ck] = v;
      else delete next[ck];
      return next;
    });
  };

  const handleSave = async () => {
    if (!user || !erp?.permission) return;
    setSaving(true);
    try {
      await erp.permission.setUserScopes({ userId: user.id, resourceType: "mall", resourceIds: selectedMalls });
      const entries = Object.entries(overrides).map(([composite, access]) => {
        const idx = composite.indexOf("|");
        return {
          resourceType: composite.slice(0, idx),
          resourceKey: composite.slice(idx + 1),
          accessLevel: access,
        };
      });
      await erp.permission.setUserOverrides({ userId: user.id, entries });
      message.success("用户权限已保存");
      onClose(true);
    } catch (error: any) {
      message.error(error?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (type: string, item: { key: string; label: string }) => {
    const ck = `${type}|${item.key}`;
    const def = isDefaultAllowed(type, item.key);
    return (
      <div key={ck} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
        <span style={{ fontSize: 13 }}>{item.label}</span>
        <Space size={8}>
          <Tag color={def ? "green" : "default"} style={{ marginRight: 0 }}>{`默认${def ? "允许" : "禁止"}`}</Tag>
          <Segmented
            size="small"
            value={overrides[ck] || "inherit"}
            disabled={privileged}
            onChange={(v) => updateOverride(ck, String(v))}
            options={[
              { label: "跟随", value: "inherit" },
              { label: "允许", value: "allow" },
              { label: "禁止", value: "deny" },
            ]}
          />
        </Space>
      </div>
    );
  };

  const renderGroups = (type: string, groups: PermissionCatalogGroup[]) => (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      {groups.map((g) => (
        <div key={g.group}>
          <Text type="secondary" style={{ fontSize: 12 }}>{g.group}</Text>
          <div style={{ marginTop: 2 }}>{g.items.map((it) => renderRow(type, it))}</div>
        </div>
      ))}
    </Space>
  );

  const mallOptions = [...malls]
    .sort((a, b) => {
      const na = parseInt((a.store_code || "").trim(), 10);
      const nb = parseInt((b.store_code || "").trim(), 10);
      const ka = Number.isFinite(na) ? na : Number.MAX_SAFE_INTEGER;
      const kb = Number.isFinite(nb) ? nb : Number.MAX_SAFE_INTEGER;
      return ka - kb;
    })
    .map((m) => ({ label: formatStoreLabel(m), value: m.mall_id }));

  return (
    <Modal
      open={open}
      title={user ? `权限与店铺 · ${user.name}` : "权限与店铺"}
      width={960}
      onCancel={() => onClose(false)}
      onOk={handleSave}
      okText="保存"
      confirmLoading={saving}
      destroyOnClose
    >
      <Spin spinning={loading}>
        {privileged ? (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="管理员 / 负责人拥有全部权限和全部店铺，无需单独配置。" />
        ) : null}

        <div style={{ marginBottom: 16 }}>
          <Text strong>负责的店铺</Text>
          <div style={{ marginTop: 6 }}>
            <Select
              mode="multiple"
              allowClear
              disabled={privileged}
              style={{ width: "100%" }}
              placeholder="选择该用户负责的店铺（开启数据隔离后，TA 只能看到这些店铺的数据）"
              value={selectedMalls}
              onChange={(vals) => setSelectedMalls(vals as string[])}
              options={mallOptions}
              optionFilterProp="label"
              showSearch
              maxTagCount="responsive"
            />
          </div>
        </div>

        <Text strong>权限覆盖</Text>
        <div style={{ marginTop: 2, marginBottom: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>「跟随」用角色默认；「允许 / 禁止」对该用户单独生效，优先于角色。</Text>
        </div>
        {view ? (
          <div style={{ maxHeight: "56vh", overflowY: "auto", paddingRight: 8 }}>
            <Row gutter={24}>
              <Col span={12}>
                <div style={{ marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--color-border, #f0f0f0)" }}>
                  <Text strong>菜单权限</Text>
                </div>
                {renderGroups("menu", view.catalog.menus)}
              </Col>
              <Col span={12}>
                <div style={{ marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--color-border, #f0f0f0)" }}>
                  <Text strong>操作权限</Text>
                </div>
                {renderGroups("action", view.catalog.actions)}
              </Col>
            </Row>
          </div>
        ) : null}
      </Spin>
    </Modal>
  );
}
