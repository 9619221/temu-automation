import React, { useState } from "react";
import type { DesignerResult } from "./types";
import { SharedDnaCard } from "./SharedDnaCard";
import { BriefThumbnail } from "./BriefThumbnail";
import { BriefCopyPreview } from "./BriefCopyPreview";

interface Props {
  result: DesignerResult;
  /** 原始产品图 File，用于调 compose 管道把 wireframe 变成真 pixel */
  primaryUploadFile?: File | null;
}

interface ComposedImage {
  slot: number;
  method: string;
  dataUrl: string;
  bytes: number;
}

// 把 File 读成 data:image/png;base64,... 字符串
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error || new Error("read file failed"));
    fr.readAsDataURL(file);
  });
}

// 总摘要：DNA + 10 个 Brief 缩略 + 审稿报告
export function DesignerSummary({ result, primaryUploadFile }: Props) {
  const { sharedDna, briefs, auditReport, warnings, errors, reworkRounds } = result;
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composedImages, setComposedImages] = useState<ComposedImage[]>([]);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const composedBySlot = React.useMemo(() => {
    const m = new Map<number, ComposedImage>();
    for (const img of composedImages) m.set(img.slot, img);
    return m;
  }, [composedImages]);

  const canCompose = briefs.length > 0 && !!sharedDna;

  const handleCompose = async () => {
    if (!canCompose) return;
    const api = (typeof window !== "undefined"
      ? (window as any).electronAPI?.imageStudioGpt
      : null);
    if (!api?.composeBriefs) {
      setComposeError("当前环境不支持合成（仅 Electron 窗口可用）");
      return;
    }
    setComposing(true);
    setComposeError(null);
    const t0 = performance.now();
    try {
      let productImageBase64: string | null = null;
      if (primaryUploadFile) {
        productImageBase64 = await readFileAsDataUrl(primaryUploadFile);
      }
      const res = await api.composeBriefs({
        briefs,
        sharedDna,
        productImageBase64,
      });
      if (res?.error) throw new Error(String(res.error));
      if (!Array.isArray(res?.images)) throw new Error("compose 返回格式异常");
      setComposedImages(res.images as ComposedImage[]);
      setElapsedMs(Math.round(performance.now() - t0));
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : String(err));
    } finally {
      setComposing(false);
    }
  };

  const selectedBrief = briefs.find(
    (b) => Number(b.id.replace("brief-", "")) === selectedSlot
  );

  const verdictColor =
    auditReport?.overallVerdict === "pass"
      ? "#059669"
      : auditReport?.overallVerdict === "pass-with-warnings"
      ? "#d97706"
      : "#dc2626";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 顶部状态 */}
      <div
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          background: result.ok ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 13,
        }}
      >
        <div>
          <strong style={{ color: result.ok ? "#065f46" : "#7f1d1d" }}>
            {result.ok ? "✓ 设计师 Agent 完成" : "✗ 设计师 Agent 失败"}
          </strong>
          {auditReport && (
            <span style={{ marginLeft: 12, color: verdictColor, fontSize: 12 }}>
              审稿：{auditReport.overallVerdict}
            </span>
          )}
          {reworkRounds > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: "#6b7280" }}>
              返工 {reworkRounds} 轮
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>{briefs.length} 张图</div>
      </div>

      {/* 错误 / 警告 */}
      {errors.length > 0 && (
        <MsgList label="错误" color="#dc2626" bg="#fef2f2" items={errors} />
      )}
      {warnings.length > 0 && (
        <MsgList label="警告" color="#b45309" bg="#fffbeb" items={warnings} />
      )}

      {/* SharedDNA */}
      {sharedDna && <SharedDnaCard dna={sharedDna} />}

      {/* 10 张图缩略格 */}
      {briefs.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>
              10 张图{composedImages.length > 0 ? "（已合成真实 pixel）" : "缩略版式"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {elapsedMs != null && (
                <span style={{ fontSize: 11, color: "#6b7280" }}>
                  合成耗时 {elapsedMs} ms · {composedImages.length} 张
                </span>
              )}
              <button
                type="button"
                disabled={!canCompose || composing}
                onClick={handleCompose}
                style={{
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: "1px solid #3b82f6",
                  background: composing ? "#93c5fd" : "#3b82f6",
                  color: "#fff",
                  cursor: !canCompose || composing ? "not-allowed" : "pointer",
                  opacity: !canCompose ? 0.5 : 1,
                }}
              >
                {composing
                  ? "合成中…"
                  : composedImages.length > 0
                  ? "重新合成真实图"
                  : "🎨 合成真实图"}
              </button>
            </div>
          </div>
          {composeError && (
            <div
              style={{
                padding: "6px 10px",
                marginBottom: 10,
                borderRadius: 6,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                fontSize: 12,
                color: "#b91c1c",
              }}
            >
              合成失败：{composeError}
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            {briefs.map((b) => {
              const slot = Number(b.id.replace("brief-", ""));
              const composed = composedBySlot.get(slot);
              return (
                <div
                  key={b.id}
                  onClick={() => setSelectedSlot(selectedSlot === slot ? null : slot)}
                  style={{
                    cursor: "pointer",
                    outline:
                      selectedSlot === slot ? "2px solid #3b82f6" : "none",
                    outlineOffset: 2,
                    borderRadius: 8,
                    position: "relative",
                  }}
                >
                  {composed ? (
                    <div style={{ position: "relative", width: 160 }}>
                      <img
                        src={composed.dataUrl}
                        alt={`slot-${slot}`}
                        style={{
                          width: 160,
                          height: 200,
                          objectFit: "cover",
                          borderRadius: 8,
                          display: "block",
                          background: "#f3f4f6",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: 4,
                          left: 4,
                          padding: "2px 6px",
                          fontSize: 10,
                          fontWeight: 600,
                          borderRadius: 4,
                          background:
                            composed.method === "ai-regen"
                              ? "rgba(217,119,6,0.9)"
                              : "rgba(5,150,105,0.9)",
                          color: "#fff",
                        }}
                      >
                        #{slot} {composed.method}
                      </div>
                      <div
                        style={{
                          position: "absolute",
                          bottom: 4,
                          right: 4,
                          padding: "1px 5px",
                          fontSize: 10,
                          borderRadius: 4,
                          background: "rgba(0,0,0,0.55)",
                          color: "#fff",
                        }}
                      >
                        {(composed.bytes / 1024).toFixed(0)} KB
                      </div>
                    </div>
                  ) : (
                    <BriefThumbnail
                      brief={b}
                      slot={slot}
                      palette={sharedDna?.palette}
                      width={160}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 选中单张的详情 */}
      {selectedBrief && (
        <div
          style={{
            border: "1px solid #bfdbfe",
            borderRadius: 12,
            padding: 16,
            background: "#eff6ff",
            display: "grid",
            gridTemplateColumns: "200px 1fr",
            gap: 16,
          }}
        >
          <BriefThumbnail
            brief={selectedBrief}
            slot={selectedSlot!}
            palette={sharedDna?.palette}
            width={200}
          />
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1e3a8a" }}>
              Slot {selectedSlot} · {selectedBrief.imageType}
            </div>
            <div style={{ fontSize: 12, color: "#374151" }}>
              {selectedBrief.rationale}
            </div>
            <BriefCopyPreview brief={selectedBrief} />
          </div>
        </div>
      )}

      {/* 审稿报告摘要 */}
      {auditReport && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 16,
            background: "#fff",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "#111" }}>
            审稿报告
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
            {auditReport.summary}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {Object.entries(auditReport.consistencyChecks).map(([k, v]) => (
              <div
                key={k}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  background:
                    v.status === "ok"
                      ? "#f0fdf4"
                      : v.status === "warning"
                      ? "#fffbeb"
                      : "#fef2f2",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 11, color: "#6b7280" }}>{k}</div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color:
                      v.status === "ok"
                        ? "#059669"
                        : v.status === "warning"
                        ? "#d97706"
                        : "#dc2626",
                  }}
                >
                  {v.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MsgList({
  label,
  color,
  bg,
  items,
}: {
  label: string;
  color: string;
  bg: string;
  items: string[];
}) {
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${color}33`,
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color, marginBottom: 4 }}>
        {label}（{items.length}）
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#374151" }}>
        {items.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  );
}
