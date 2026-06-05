import PageHeader from "../components/PageHeader";
import PurchaseReturnsSection from "../components/PurchaseReturnsSection";
import ConsignAfterSalesSection from "../components/ConsignAfterSalesSection";
import { Tabs } from "antd";
import { useSessionState } from "../hooks/useSessionState";

export default function AfterSales() {
  // 会话级记住当前子 Tab：切走再切回售后页时停在原来的「送仓售后 / 采购退货」，重启软件清空。
  const [activeKey, setActiveKey] = useSessionState("temu.after-sales.tab", "consign");
  return (
    <div>
      <PageHeader
        title="售后"
        subtitle="送仓售后 / 采购退货 分两个 Tab 看。"
        eyebrow="运营"
      />

      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={[
          { key: "consign", label: "送仓售后", children: <ConsignAfterSalesSection /> },
          { key: "purchase-return", label: "采购退货", children: <PurchaseReturnsSection /> },
        ]}
      />
    </div>
  );
}
