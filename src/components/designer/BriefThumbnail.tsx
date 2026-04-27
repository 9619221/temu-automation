import React from "react";
import type { DesignBrief, BBox } from "./types";

interface Props {
  brief: DesignBrief;
  slot: number;                    // 1-10
  palette?: {                      // 从 SharedDNA 传入，画底色用
    neutral: string;
    primary: string;
    accent: string;
    text: string;
  };
  width?: number;                  // 缩略图宽，默认 180
}

/**
 * 单张图的缩略版式
 * 用 CSS absolute 按 bbox 百分比画：
 *   - 产品框（灰底色块）
 *   - 文字区（彩色半透明）
 *   - 道具槽（虚线框）
 */
export function BriefThumbnail({ brief, slot, palette, width = 180 }: Props) {
  const [w, h] = parseAspect(brief.canvas.aspectRatio); // 4:5 → [4, 5]
  const height = (width * h) / w;

  const bg = palette?.neutral ?? "#f8f5ee";
  const productBg = palette?.primary ?? "#d4c4a8";
  const textBg = palette?.accent ?? "#c9a063";

  return (
    <div
      style={{
        width,
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        overflow: "hidden",
        background: "#fff",
        flexShrink: 0,
      }}
    >
      {/* 画布区 */}
      <div
        style={{
          position: "relative",
          width,
          height,
          background: bg,
        }}
      >
        {/* 产品框 */}
        <AbsBox bbox={brief.composition.productBox} style={{ background: productBg }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "rgba(0,0,0,0.5)",
            }}
          >
            产品
          </div>
        </AbsBox>

        {/* 文字区 */}
        {brief.textZones.map((tz) => (
          <AbsBox
            key={tz.id}
            bbox={tz.bbox}
            style={{
              background: `${textBg}CC`,
              border: "1px dashed rgba(0,0,0,0.3)",
              fontSize: 9,
              color: palette?.text ?? "#fff",
              padding: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: tz.alignment,
            }}
          >
            {tz.role}
          </AbsBox>
        ))}

        {/* 道具槽 */}
        {brief.propsSlots.map((p) => (
          <AbsBox
            key={p.id}
            bbox={p.bbox}
            style={{
              border: "1.5px dashed #6b7280",
              background: "transparent",
              fontSize: 9,
              color: "#6b7280",
              display: "flex",
              alignItems: "flex-start",
              padding: 2,
            }}
          >
            {p.kind}
          </AbsBox>
        ))}

        {/* slot 角标 */}
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            fontWeight: 600,
          }}
        >
          {slot}
        </div>

        {/* 执行方式角标 */}
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            background:
              brief.engineDirective.method === "compose"
                ? "#dbeafe"
                : brief.engineDirective.method === "ai-regen"
                ? "#fef3c7"
                : "#ede9fe",
            color: "#111",
            fontSize: 9,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {brief.engineDirective.method}
        </div>
      </div>

      {/* 底部 meta */}
      <div
        style={{
          padding: "6px 8px",
          borderTop: "1px solid #f3f4f6",
          fontSize: 11,
          color: "#374151",
        }}
      >
        <div style={{ fontWeight: 500 }}>{brief.imageType}</div>
        <div style={{ fontSize: 10, color: "#9ca3af" }}>
          {brief.composition.cameraAngle} · {brief.composition.focalLength}
        </div>
      </div>
    </div>
  );
}

function AbsBox({
  bbox,
  style,
  children,
}: {
  bbox: BBox;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${bbox.x * 100}%`,
        top: `${bbox.y * 100}%`,
        width: `${bbox.w * 100}%`,
        height: `${bbox.h * 100}%`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function parseAspect(ratio: string): [number, number] {
  const m = ratio.match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return [4, 5];
  return [Number(m[1]), Number(m[2])];
}
