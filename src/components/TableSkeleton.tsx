import { Skeleton } from "antd";

/**
 * 列表/表格骨架屏。冷启动(无缓存)首屏用,替代居中全屏 <Spin>,
 * 并贴近真实表格密度以减少布局跳动(见 docs/frontend-response-cache-spec.md §4)。
 */

export interface TableSkeletonProps {
  /** 骨架行数,贴近真实首屏密度,默认 8。 */
  rows?: number;
  /** 是否显示表头骨架,默认 true。 */
  header?: boolean;
}

export function TableSkeleton({ rows = 8, header = true }: TableSkeletonProps) {
  return (
    <div style={{ padding: "8px 0" }}>
      {header && (
        <Skeleton.Input
          active
          block
          size="small"
          style={{ height: 28, marginBottom: 12, opacity: 0.7 }}
        />
      )}
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton.Input
          key={index}
          active
          block
          style={{ height: 36, marginBottom: 8 }}
        />
      ))}
    </div>
  );
}

export default TableSkeleton;
