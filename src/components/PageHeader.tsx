import type { ReactNode } from "react";
import { Space } from "antd";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode | ReactNode[];
  eyebrow?: ReactNode;
  meta?: ReactNode | ReactNode[];
  compact?: boolean;
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow = "工作台",
  meta,
  compact = false,
  className = "",
}: PageHeaderProps) {
  const actionList = Array.isArray(actions) ? actions : actions ? [actions] : [];
  const metaList = Array.isArray(meta) ? meta : meta ? [meta] : [];
  const rootClassName = ["app-page-header", "app-surface", compact ? "app-page-header--compact" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      <div className="app-page-header__content">
        {eyebrow ? <div className="app-page-header__eyebrow">{eyebrow}</div> : null}
        <h1 className="app-page-header__title">{title}</h1>
        {subtitle ? <div className="app-page-header__subtitle">{subtitle}</div> : null}
        {metaList.length > 0 ? (
          <div className="app-page-header__meta">
            {metaList.map((item, index) => (
              <span key={index} className="app-page-header__meta-pill">{item}</span>
            ))}
          </div>
        ) : null}
      </div>
      {actionList.length > 0 ? (
        <Space size={12} wrap className="app-page-header__actions">
          {actionList.map((action, index) => (
            <span key={index}>{action}</span>
          ))}
        </Space>
      ) : null}
    </div>
  );
}
