// 运营工作台多个 Tab 共用的筛选栏:店铺下拉 +(可选)各 Tab 专属筛选 extra + 搜索框。
// state 仍由容器(OperationsWorkbench)持有,本组件纯受控,通过 props 接入。
// 注意:搜索框绑的是 searchInput(跟手),下游过滤用的是防抖后的 search——两个值,见容器。
import { Input, Select } from "antd";
import type { ReactNode } from "react";

interface OpsCommonFiltersProps {
  storeFilter: string;
  onStoreChange: (v: string) => void;
  storeOptions: string[];
  searchInput: string;
  onSearchChange: (v: string) => void;
  extra?: ReactNode;
}

export default function OpsCommonFilters({ storeFilter, onStoreChange, storeOptions, searchInput, onSearchChange, extra }: OpsCommonFiltersProps) {
  return (
    <div style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <Select size="small" style={{ width: 130 }} value={storeFilter} onChange={onStoreChange} options={[{ value: "all", label: "全部店铺" }, ...storeOptions.map((c) => ({ value: c, label: c }))]} />
      {extra}
      <Input.Search size="small" allowClear placeholder="搜货号 / SKC / SPU / 标题" style={{ width: 220 }} value={searchInput} onChange={(e) => onSearchChange(e.target.value)} />
    </div>
  );
}
