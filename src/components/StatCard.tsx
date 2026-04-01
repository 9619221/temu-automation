import type { ReactNode } from "react";

type StatCardColor = "brand" | "success" | "blue" | "purple" | "danger" | "neutral";

interface StatCardProps {
  title: string;
  value?: ReactNode;
  icon?: ReactNode;
  color?: StatCardColor;
  trend?: ReactNode;
  empty?: string;
  suffix?: ReactNode;
  footer?: ReactNode;
  className?: string;
  compact?: boolean;
}

const COLOR_CLASS_MAP: Record<StatCardColor, string> = {
  brand: "brand",
  success: "success",
  blue: "blue",
  purple: "purple",
  danger: "danger",
  neutral: "neutral",
};

function isEmptyValue(value: ReactNode) {
  return (
    value === null
    || value === undefined
    || value === ""
    || value === "-"
  );
}

export default function StatCard({
  title,
  value,
  icon,
  color = "brand",
  trend,
  empty = "采集后显示",
  suffix,
  footer,
  className = "",
  compact = false,
}: StatCardProps) {
  const emptyState = isEmptyValue(value);
  const cardClassName = ["app-stat-card", `app-stat-card--${COLOR_CLASS_MAP[color]}`, compact ? "app-stat-card--compact" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClassName}>
      <div className="app-stat-card__head">
        <div>
          <div className="app-stat-card__title">{title}</div>
          <div className={emptyState ? "app-stat-card__value is-empty" : "app-stat-card__value"}>
            <span>{emptyState ? "--" : value}</span>
            {!emptyState && suffix ? <span className="app-stat-card__suffix">{suffix}</span> : null}
          </div>
        </div>
        {icon ? <div className="app-stat-card__icon">{icon}</div> : null}
      </div>
      {emptyState ? (
        <div className="app-stat-card__empty">{empty}</div>
      ) : (
        <div className="app-stat-card__meta">{trend || footer || <span className="app-stat-card__placeholder">已同步</span>}</div>
      )}
    </div>
  );
}
