import type { ReactNode } from "react";

interface EmptyGuideProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export default function EmptyGuide({ icon, title, description, action }: EmptyGuideProps) {
  return (
    <div className="app-empty-guide">
      {icon ? <div className="app-empty-guide__icon">{icon}</div> : null}
      <div className="app-empty-guide__title">{title}</div>
      {description ? <div className="app-empty-guide__description">{description}</div> : null}
      {action ? <div className="app-empty-guide__action">{action}</div> : null}
    </div>
  );
}
