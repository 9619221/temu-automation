import React from "react";
import type { SharedDNA } from "./types";

interface Props {
  dna: SharedDNA;
}

// 色板五色 + 字体 + 情绪词 + 光线一览
export function SharedDnaCard({ dna }: Props) {
  const paletteEntries: Array<[string, string]> = [
    ["主色", dna.palette.primary],
    ["辅色", dna.palette.secondary],
    ["点缀", dna.palette.accent],
    ["背景", dna.palette.neutral],
    ["文字", dna.palette.text],
  ];

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 16,
        background: "#fff",
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14, color: "#111" }}>
        视觉基因 SharedDNA
      </div>

      {/* 色板 */}
      <div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>色板</div>
        <div style={{ display: "flex", gap: 8 }}>
          {paletteEntries.map(([label, hex]) => (
            <div key={label} style={{ flex: 1, textAlign: "center" }}>
              <div
                style={{
                  height: 44,
                  borderRadius: 8,
                  background: hex,
                  border: "1px solid #e5e7eb",
                }}
                title={hex}
              />
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{label}</div>
              <div style={{ fontSize: 10, color: "#999", fontFamily: "monospace" }}>
                {hex}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 情绪 + 光线 + 字体 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <DnaField label="情绪">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {dna.mood.map((m) => (
              <span
                key={m}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "#f3f4f6",
                  color: "#374151",
                }}
              >
                {m}
              </span>
            ))}
          </div>
        </DnaField>

        <DnaField label="光线">
          <div style={{ fontSize: 12, color: "#374151" }}>
            {dna.lighting.style}
            <br />
            <span style={{ color: "#9ca3af", fontSize: 11 }}>
              {dna.lighting.direction} · {dna.lighting.intensity}
            </span>
          </div>
        </DnaField>

        <DnaField label="字体">
          <div style={{ fontSize: 12, color: "#374151" }}>
            {dna.typography.headlineFamily}
            <br />
            <span style={{ color: "#9ca3af", fontSize: 11 }}>
              w{dna.typography.headlineWeight} · {dna.typography.caseStyle}
            </span>
          </div>
        </DnaField>
      </div>

      {/* 禁用元素 */}
      {dna.globalForbidden?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
            全局禁用
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {dna.globalForbidden.map((f) => (
              <span
                key={f}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "#fef2f2",
                  color: "#991b1b",
                  border: "1px solid #fecaca",
                }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DnaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
