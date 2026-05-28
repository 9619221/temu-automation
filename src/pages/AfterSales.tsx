import PageHeader from "../components/PageHeader";
import PurchaseReturnsSection from "../components/PurchaseReturnsSection";
import ConsignAfterSalesSection from "../components/ConsignAfterSalesSection";
import { Tabs } from "antd";

export default function AfterSales() {
  return (
    <div>
      <PageHeader
        title="售后"
        subtitle="送仓售后 / 采购退货 分两个 Tab 看。"
        eyebrow="运营"
      />

      <Tabs
        defaultActiveKey="consign"
        items={[
          { key: "consign", label: "送仓售后", children: <ConsignAfterSalesSection /> },
          { key: "purchase-return", label: "采购退货", children: <PurchaseReturnsSection /> },
        ]}
      />
    </div>
  );
}
