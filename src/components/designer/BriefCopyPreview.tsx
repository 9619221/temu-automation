import React from "react";
import type { DesignBrief } from "./types";

interface Props {
  brief: DesignBrief;
}

// 单张图的文案预览：headline / subhead / pills / captions / anchorObject
export function BriefCopyPreview({ brief }: Props) {
  const { fillIns, constraints } = brief;
  const totalChars =
    (fillIns.headline?.length || 0) +
    (fillIns.subhead?.length || 0) +
    (fillIns.pillLabels || []).reduce((s, t) => s + t.length, 0) +
    (fillIns.captions || []).reduce((s, t) => s + t.length, 0);

  const overBudget = constraints.textBudget > 0 && totalChars > constraints.textBudget;

  return (
    <div
      style={{
        fontSize: 12,
        color: "#374151",
        display: "grid",
        gap: 6,
        padding: 8,
        background: "#fafafa",
        borderRadius: 6,
      }}
    >
      {fillIns.headline && (
        <Row label="Headline">
          <strong style={{ fontSize: 13 }}>{fillIns.headline}</strong>
        </Row>
      )}
      {fillIns.subhead && <Row label="Subhead">{fillIns.subhead}</Row>}
      {fillIns.pillLabels?.length > 0 && (
        <Row label="Pills">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {fillIns.pillLabels.map((p, i) => (
              <span
                key={i}
                style={{
                  background: "#e0e7ff",
                  padding: "1px 6px",
                  borderRadius: 999,
                  fontSize: 11,
                }}
              >
                {p}
              </span>
            ))}
          </div>
        </Row>
      )}
      {fillIns.captions?.length > 0 && (
        <Row label="Captions">
          {fillIns.captions.map((c, i) => (
            <div key={i} style={{ fontSize: 11, color: "#6b7280" }}>
              · {c}
            </div>
          ))}
        </Row>
      )}
      {fillIns.anchorObject && (
        <Row label="锚物">
          <span
            style={{
              background: "#ecfccb",
              padding: "1px 6px",
              borderRadius: 4,
              fontSize: 11,
              color: "#3f6212",
            }}
          >
            {fillIns.anchorObject}
          </span>
        </Row>
      )}

      <div
        style={{
          marginTop: 4,
          paddingTop: 6,
          borderTop: "1px dashed #e5e7eb",
          fontSize: 10,
          color: overBudget ? "#b91c1c" : "#9ca3af",
        }}
      >
        字符 {totalChars}/{constraints.textBudget}
        {overBudget ? "（超限）" : ""}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 8, alignItems: "start" }}>
      <div style={{ fontSize: 10, color: "#9ca3af", paddingTop: 2 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}
