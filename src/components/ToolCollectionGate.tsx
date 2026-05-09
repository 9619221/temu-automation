import { Button, Space, Typography } from "antd";
import { ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import EmptyGuide from "./EmptyGuide";
import type { ToolCollectionRequirementViewState } from "../hooks/useToolCollectionGate";

const { Text } = Typography;

interface ToolCollectionGateProps {
  state: ToolCollectionRequirementViewState;
  onOpenCollect: () => void;
}

export default function ToolCollectionGate({ state, onOpenCollect }: ToolCollectionGateProps) {
  return (
    <div style={{ padding: "24px 0" }}>
      <EmptyGuide
        icon={<SyncOutlined />}
        title="先采集店铺数据"
        description={
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <Text style={{ color: "#595959" }}>
              每天 9:00 之后，工具页需要先完成一遍完整的数据采集。
            </Text>
            <Text type="secondary">
              最近完整采集：{state.lastCollectionLabel || "尚未完成完整采集"}
            </Text>
            {state.reason ? (
              <Text style={{ color: "#cf1322" }}>{state.reason}</Text>
            ) : null}
          </div>
        }
        action={
          <Space size={10} wrap>
            <Button type="primary" icon={<SyncOutlined />} onClick={onOpenCollect}>
              去数据采集
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void state.refresh()} loading={state.loading}>
              重新检查
            </Button>
          </Space>
        }
      />
    </div>
  );
}
