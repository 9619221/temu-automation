/**
 * AI 生图（多 agent / Supervisor 版）
 *
 * 一键编排：上传商品图 → analyze 出 AnalysisResult → POST 启动 9-agent Supervisor
 * → 轮询 job（state + logs + generatedSlotOrders）→ 渲染阶段进度 + 逐张出图。
 *
 * 后端是异步 job + 落盘 + 轮询模型（非 SSE）。M1 阶段走本地子进程的 /api/agent/*，
 * 后续（M3）main.cjs 把 /api/agent/* 整体切到云端 erp.temu.chat，本组件无需改动。
 */
import { useEffect, useRef, useState } from "react";
import { IMAGE_LANGUAGE_OPTIONS, getDefaultImageLanguageForRegion } from "../utils/imageStudio";

const api = (typeof window !== "undefined" ? (window as any).electronAPI?.imageStudioGpt : null);

/* ============================ 类型 ============================ */

interface LogEntry {
  step: string;
  timestamp: number;
  note: string;
}

interface SupervisorState {
  step: string;
  images?: Array<{ slotOrder?: number; shotOrder?: number; imageUrl?: string; error?: string }>;
  [k: string]: unknown;
}

interface PollResult {
  jobId: string;
  state: SupervisorState | null;
  logs: LogEntry[];
  generatedSlotOrders: number[];
  error?: string;
}

interface FilePayload {
  name: string;
  type: string;
  size: number;
  buffer: ArrayBuffer;
}

/* ============================ 常量 / 映射 ============================ */

// logs[].step（checkpoint 的 agent 名）→ 中文标签
const STEP_LABELS: Record<string, string> = {
  supervisor: "主持人",
  "product-director": "产品总监 · 产品宪法",
  "business-strategist": "商业策略师 · 定位",
  "taobao-ops": "淘宝运营 · 出图规划",
  "creative-director": "创意总监 · 创意方向",
  "brand-director": "品牌总监 · VI 系统",
  "asset-library-planner": "素材库 · 规划",
  "asset-library-builder": "素材库 · 生成",
  "storyboard-director": "分镜师 · 分镜",
  "reference-coordinator": "参考图 · 调度",
  copywriter: "文案专家 · 图上文案",
  photographer: "摄影师 · 写 prompt",
  review: "全员审阅",
  "image-executor": "生图执行",
};

// state.step（PipelineStep 状态机）→ 中文 + 是否终态
const PIPELINE_STEP_LABELS: Record<string, string> = {
  analyze: "已接收，准备启动",
  product_constitution_drafted: "产品宪法已定",
  business_positioning_drafted: "商业定位已定",
  taobao_plan_drafted: "淘宝出图规划已定",
  creative_direction_drafted: "创意方向已定",
  asset_library_planned: "素材清单已规划",
  asset_library_built: "素材库已生成",
  vi_lock_drafted: "VI 系统已锁定",
  storyboard_drafted: "分镜已完成",
  reference_assigned: "参考图已分配",
  copy_drafted: "图上文案已完成",
  prompts_drafted: "全部 prompt 已就绪",
  review_in_progress: "全员审阅中",
  review_passed: "审阅通过",
  review_stuck: "审阅未收敛，需人工介入",
  images_generated: "生图完成",
  completed: "全部完成",
};

const TERMINAL_STEPS = new Set(["completed", "review_stuck"]);
const POLL_INTERVAL_MS = 2500;

// 市场地区卡片（与「AI 出图」「GPT 版」保持一致）；选中后图片语言按地区自动联动
const REGION_CARDS = [
  { value: "us", code: "US", label: "美国" },
  { value: "eu", code: "EU", label: "欧洲" },
  { value: "uk", code: "GB", label: "英国" },
  { value: "jp", code: "JP", label: "日本" },
  { value: "kr", code: "KR", label: "韩国" },
  { value: "cn", code: "CN", label: "中国" },
  { value: "sea", code: "TH", label: "东南亚" },
  { value: "me", code: "SA", label: "中东" },
  { value: "latam", code: "MX", label: "拉美" },
  { value: "br", code: "BR", label: "巴西" },
  { value: "ozon", code: "RU", label: "俄罗斯" },
];

/* ============================ helpers ============================ */

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error || new Error("读取文件失败"));
    fr.readAsDataURL(file);
  });
}

async function fileToPayload(file: File): Promise<FilePayload> {
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    buffer: await file.arrayBuffer(),
  };
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
}

/* ============================ 主组件 ============================ */

export default function ImageStudioAgent() {
  const [productFiles, setProductFiles] = useState<File[]>([]);
  const [competitorFiles, setCompetitorFiles] = useState<File[]>([]);
  const [salesRegion, setSalesRegion] = useState("us");
  const [imageLanguage, setImageLanguage] = useState<string>(getDefaultImageLanguageForRegion("us"));

  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState<string>("");
  const [pipelineStep, setPipelineStep] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [images, setImages] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number>(0);
  const fetchingSlots = useRef<Set<number>>(new Set());
  const gotSlots = useRef<Set<number>>(new Set());
  const cancelledRef = useRef(false);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  // 计时器
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    return () => clearInterval(t);
  }, [running]);

  const fetchSlotImage = async (jid: string, slot: number) => {
    if (gotSlots.current.has(slot) || fetchingSlots.current.has(slot)) return;
    fetchingSlots.current.add(slot);
    try {
      const res = await api.supervisorFetchImage({ jobId: jid, slot });
      if (res?.dataUrl) {
        gotSlots.current.add(slot);
        setImages((prev) => {
          const next = new Map(prev);
          next.set(slot, res.dataUrl);
          return next;
        });
      }
    } catch {
      /* 单张拉取失败下次轮询再试 */
    } finally {
      fetchingSlots.current.delete(slot);
    }
  };

  const poll = async (jid: string) => {
    if (cancelledRef.current) return;
    let result: PollResult;
    try {
      result = await api.supervisorPoll(jid);
    } catch (err) {
      // 轮询出错不立刻终止，继续重试（job 在后端照常跑）
      setStatusText(`轮询出错，重试中：${err instanceof Error ? err.message : String(err)}`);
      pollTimer.current = setTimeout(() => poll(jid), POLL_INTERVAL_MS);
      return;
    }

    if (Array.isArray(result?.logs)) setLogs(result.logs);

    const step = result?.state?.step || "";
    if (step) {
      setPipelineStep(step);
      setStatusText(PIPELINE_STEP_LABELS[step] || step);
    }

    // 拉取新出的图
    const slots = Array.isArray(result?.generatedSlotOrders) ? result.generatedSlotOrders : [];
    for (const slot of slots) {
      void fetchSlotImage(jid, slot);
    }

    if (step && TERMINAL_STEPS.has(step)) {
      stopPolling();
      setRunning(false);
      return;
    }

    pollTimer.current = setTimeout(() => poll(jid), POLL_INTERVAL_MS);
  };

  const handleStart = async () => {
    if (!api?.supervisorStart) {
      setError("生图服务不可用，请重启软件后重试");
      return;
    }
    if (productFiles.length === 0) {
      setError("请先上传至少 1 张商品图");
      return;
    }

    // 重置
    cancelledRef.current = false;
    stopPolling();
    setError(null);
    setLogs([]);
    setImages(new Map());
    gotSlots.current = new Set();
    fetchingSlots.current = new Set();
    setJobId(null);
    setPipelineStep("");
    setRunning(true);
    startedAt.current = Date.now();
    setElapsed(0);

    try {
      // 1) analyze 出 AnalysisResult（走 /api/analyze）
      setStatusText("正在分析商品图（约 30 秒）…");
      const filePayloads = await Promise.all(productFiles.map(fileToPayload));
      const analysis = await api.analyze({
        files: filePayloads,
        productMode: "single",
        salesRegion,
        imageLanguage,
      });
      if (!analysis || analysis.error) {
        throw new Error(analysis?.error ? String(analysis.error) : "商品分析失败");
      }

      // 2) 启动 9-agent Supervisor（fire-and-forget，拿 jobId）
      setStatusText("正在启动 9-agent 流水线…");
      const productReferences = await Promise.all(productFiles.map(fileToDataUrl));
      const competitorImages = competitorFiles.length
        ? await Promise.all(competitorFiles.map(fileToDataUrl))
        : undefined;

      const startRes = await api.supervisorStart({
        analysis,
        productReferences,
        competitorImages,
        stopAtPhase: "completed",
        salesRegion,
        imageLanguage,
      });
      const jid = startRes?.jobId;
      if (!jid) throw new Error(startRes?.error ? String(startRes.error) : "启动失败，未拿到 jobId");
      setJobId(jid);
      setStatusText("流水线已启动，等待各 agent 产出…");

      // 3) 开始轮询
      poll(jid);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
      stopPolling();
    }
  };

  const handleCancel = async () => {
    cancelledRef.current = true;
    stopPolling();
    setRunning(false);
    setStatusText("已取消");
    if (jobId && api?.supervisorCancel) {
      try {
        await api.supervisorCancel(jobId);
      } catch {
        /* ignore */
      }
    }
  };

  const reachedSteps = new Set(logs.map((l) => l.step));
  const orderedImages = Array.from(images.entries()).sort((a, b) => a[0] - b[0]);

  return (
    <div style={{ padding: 24, display: "grid", gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>AI 生图 · 多 Agent 版</div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4, lineHeight: 1.6 }}>
          9 个角色 agent 协作（产品总监 → 商业策略 → 淘宝运营 → 创意 → 品牌 → 素材库 → 分镜 → 文案 →
          摄影 → 全员审阅 → 生图），一键全自动。单次约 8–15 分钟。
        </div>
      </div>

      {/* 上传区 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <UploadCard
          title="商品图（必填，可多张多角度）"
          files={productFiles}
          onChange={setProductFiles}
          disabled={running}
          accent="#1e40af"
        />
        <UploadCard
          title="竞品图（可选，供各 agent 参考学习）"
          files={competitorFiles}
          onChange={setCompetitorFiles}
          disabled={running}
          accent="#6b7280"
        />
      </div>

      {/* 目标市场 / 图片语言 */}
      <div
        style={{
          padding: 14,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          display: "grid",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>
            目标市场（决定出图风格与图上文案语言）
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b7280" }}>
            图片语言
            <select
              value={imageLanguage}
              disabled={running}
              onChange={(e) => setImageLanguage(e.target.value)}
              style={{
                padding: "4px 8px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: running ? "#f1f5f9" : "#fff",
                cursor: running ? "not-allowed" : "pointer",
              }}
            >
              {IMAGE_LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8 }}>
          {REGION_CARDS.map((region) => {
            const isSelected = salesRegion === region.value;
            return (
              <button
                key={region.value}
                type="button"
                disabled={running}
                onClick={() => {
                  setSalesRegion(region.value);
                  setImageLanguage(getDefaultImageLanguageForRegion(region.value));
                }}
                style={{
                  minHeight: 56,
                  padding: "8px 6px",
                  borderRadius: 10,
                  border: isSelected ? "1px solid #2563eb" : "1px solid #d9e1ea",
                  background: isSelected ? "#2563eb" : "#fff",
                  color: isSelected ? "#fff" : "#314156",
                  cursor: running ? "not-allowed" : "pointer",
                  textAlign: "center",
                  transition: "background-color 0.2s, color 0.2s, border-color 0.2s",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700 }}>{region.code}</div>
                <div style={{ fontSize: 11, marginTop: 2 }}>{region.label}</div>
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: "#6b7280" }}>
          当前：{REGION_CARDS.find((r) => r.value === salesRegion)?.label || salesRegion} 市场 · 图上文案语言{" "}
          {IMAGE_LANGUAGE_OPTIONS.find((o) => o.value === imageLanguage)?.label || imageLanguage}
        </div>
      </div>

      {/* 操作区 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {!running ? (
          <button
            type="button"
            onClick={handleStart}
            disabled={productFiles.length === 0}
            style={{
              padding: "10px 22px",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 8,
              border: "1px solid #059669",
              background: productFiles.length === 0 ? "#a7f3d0" : "#10b981",
              color: "#fff",
              cursor: productFiles.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            ▶ 一键生成（9-agent）
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: "10px 22px",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 8,
              border: "1px solid #dc2626",
              background: "#fff",
              color: "#b91c1c",
              cursor: "pointer",
            }}
          >
            ✕ 取消
          </button>
        )}
        {running && (
          <span style={{ fontSize: 13, color: "#374151" }}>
            ⏱ {fmtElapsed(elapsed)} · {statusText}
          </span>
        )}
        {!running && statusText && (
          <span style={{ fontSize: 13, color: TERMINAL_STEPS.has(pipelineStep) ? "#059669" : "#6b7280" }}>
            {statusText}
          </span>
        )}
        {images.size > 0 && (
          <span style={{ fontSize: 13, color: "#059669", fontWeight: 600 }}>已出图 {images.size} 张</span>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: "10px 12px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            fontSize: 13,
            color: "#b91c1c",
          }}
        >
          ✗ {error}
        </div>
      )}

      {pipelineStep === "review_stuck" && (
        <div
          style={{
            padding: "10px 12px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            fontSize: 13,
            color: "#92400e",
          }}
        >
          ⚠ 审阅环未收敛（critical 问题未清零或达迭代上限），流水线停在审阅阶段，未进入生图。可调整输入后重试。
        </div>
      )}

      {/* 进度 + 出图 */}
      {(logs.length > 0 || jobId) && (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
          {/* 阶段进度（logs 驱动） */}
          <div
            style={{
              padding: 14,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              maxHeight: 520,
              overflowY: "auto",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 10 }}>流水线进度</div>
            <div style={{ display: "grid", gap: 6 }}>
              {Object.entries(STEP_LABELS).map(([key, label]) => {
                if (key === "supervisor") return null;
                const done = reachedSteps.has(key);
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      color: done ? "#111" : "#9ca3af",
                    }}
                  >
                    <span style={{ width: 16, textAlign: "center" }}>{done ? "✓" : "○"}</span>
                    <span style={{ fontWeight: done ? 600 : 400 }}>{label}</span>
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: "#111", margin: "14px 0 8px" }}>日志</div>
            <div style={{ display: "grid", gap: 4 }}>
              {logs.slice().reverse().map((l, i) => (
                <div key={i} style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.5 }}>
                  <span style={{ color: "#1e40af", fontWeight: 600 }}>
                    {STEP_LABELS[l.step] || l.step}
                  </span>
                  ：{l.note}
                </div>
              ))}
            </div>
          </div>

          {/* 出图网格 */}
          <div
            style={{
              padding: 14,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 10 }}>
              生成结果（{images.size} 张）
            </div>
            {orderedImages.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9ca3af", padding: "40px 0", textAlign: "center" }}>
                {running ? "生图阶段会逐张出现在这里…" : "暂无图片"}
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {orderedImages.map(([slot, dataUrl]) => (
                  <div key={slot} style={{ position: "relative" }}>
                    <img
                      src={dataUrl}
                      alt={`slot-${slot}`}
                      style={{
                        width: 180,
                        height: 180,
                        objectFit: "cover",
                        borderRadius: 8,
                        border: "1px solid #e5e7eb",
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
                        background: "rgba(15,23,42,0.85)",
                        color: "#fff",
                      }}
                    >
                      #{slot}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================ 上传卡片 ============================ */

function UploadCard({
  title,
  files,
  onChange,
  disabled,
  accent,
}: {
  title: string;
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
  accent: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      style={{
        padding: 14,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: accent }}>{title}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          style={{
            padding: "6px 14px",
            fontSize: 13,
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: disabled ? "#f1f5f9" : "#fff",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          选择图片
        </button>
        <span style={{ fontSize: 12, color: "#6b7280" }}>已选 {files.length} 张</span>
        {files.length > 0 && !disabled && (
          <button
            type="button"
            onClick={() => onChange([])}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid #fecaca",
              background: "#fff",
              color: "#b91c1c",
              cursor: "pointer",
            }}
          >
            清空
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const list = Array.from(e.target.files || []);
            if (list.length) onChange([...files, ...list]);
            e.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {files.map((f, i) => (
            <span
              key={i}
              style={{
                fontSize: 11,
                color: "#374151",
                background: "#f1f5f9",
                padding: "2px 8px",
                borderRadius: 10,
                maxWidth: 160,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {f.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
