import { useEffect, useMemo, useRef, useState } from "react";
import type { ImagePrompt } from "./types";

/* ============================================================
 * 类型
 * ========================================================== */

interface OpsBrief {
  productName: string;
  productDescription: string;
  howToUse: string;
  sellingPoints: string[];
  targetAudience: { buyer: string; user: string };
  painPointsAndNeeds: string[];
  imageStyle: string;
}

type SlotStatus = "idle" | "generating" | "success" | "error";

interface SlotState {
  slot: number;
  status: SlotStatus;
  dataUrl?: string;
  error?: string;
  bytes?: number;
}

type Step = 0 | 1 | 2 | 3;

interface Props {
  /** 用户上传的产品图（第 1 张） */
  primaryUploadFile: File | null;
}

/* ============================================================
 * Helpers
 * ========================================================== */

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error || new Error("read file failed"));
    fr.readAsDataURL(file);
  });
}

const api = (typeof window !== "undefined"
  ? (window as any).electronAPI?.imageStudioGpt
  : null);

/* ============================================================
 * 主组件
 * ========================================================== */

export function DesignerStudioPanel({ primaryUploadFile }: Props) {
  const [step, setStep] = useState<Step>(0);

  // Step 0
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Step 1: OpsBrief（用户可改）
  const [opsBrief, setOpsBrief] = useState<OpsBrief | null>(null);

  // Step 2: 设计师 Agent 结果
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [productIdentity, setProductIdentity] = useState<string>("");
  const [globalForbidden, setGlobalForbidden] = useState<string[]>([]);
  const [imagePrompts, setImagePrompts] = useState<ImagePrompt[]>([]);
  const [promptOverrides, setPromptOverrides] = useState<Map<number, string>>(new Map());
  const [enabledSlots, setEnabledSlots] = useState<Set<number>>(new Set());

  // Step 3: SSE 生图
  const [generating, setGenerating] = useState(false);
  const [generateJobId, setGenerateJobId] = useState<string | null>(null);
  const [slotStates, setSlotStates] = useState<Map<number, SlotState>>(new Map());
  const [generateGlobalError, setGenerateGlobalError] = useState<string | null>(null);
  const eventUnsubRef = useRef<null | (() => void)>(null);

  // 选中详情
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

  /* ============================================================
   * Step 0 → 1：运营 Agent
   * ========================================================== */

  const canAnalyze = !!primaryUploadFile && !!api?.designerAnalyze;

  const handleAnalyze = async () => {
    if (!primaryUploadFile || !api?.designerAnalyze) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const productImageBase64 = await readFileAsDataUrl(primaryUploadFile);
      const res = await api.designerAnalyze({ productImageBase64 });
      if (res?.error) throw new Error(String(res.error));
      if (!res?.opsBrief) throw new Error("analyze 返回缺 opsBrief");
      setOpsBrief(res.opsBrief);
      setStep(1);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  /* ============================================================
   * Step 1 → 2：设计师 Agent
   * ========================================================== */

  const canPlan = !!opsBrief && !!primaryUploadFile && !!api?.designerPlan;

  const handlePlan = async () => {
    if (!opsBrief || !primaryUploadFile || !api?.designerPlan) return;
    setPlanning(true);
    setPlanError(null);
    try {
      const productImageBase64 = await readFileAsDataUrl(primaryUploadFile);
      const res = await api.designerPlan({ opsBrief, productImageBase64 });
      if (res?.error) throw new Error(String(res.error));
      if (!Array.isArray(res?.imagePrompts) || res.imagePrompts.length === 0) {
        throw new Error("plan 返回缺 imagePrompts");
      }
      setProductIdentity(String(res.productIdentity || ""));
      setGlobalForbidden(Array.isArray(res.globalForbidden) ? res.globalForbidden : []);
      setImagePrompts(res.imagePrompts as ImagePrompt[]);
      setPromptOverrides(new Map());
      // 默认全选
      setEnabledSlots(new Set((res.imagePrompts as ImagePrompt[]).map((p) => p.slot)));
      // slot 状态全清零
      const initStates = new Map<number, SlotState>();
      for (const p of res.imagePrompts as ImagePrompt[]) {
        initStates.set(p.slot, { slot: p.slot, status: "idle" });
      }
      setSlotStates(initStates);
      setStep(2);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanning(false);
    }
  };

  /* ============================================================
   * Step 2 → 3：开始生图（SSE）
   * ========================================================== */

  const getEffectivePrompt = (slot: number, original: string) =>
    promptOverrides.get(slot) ?? original;

  const handleStartGenerate = async () => {
    if (!api?.designerGenerateStart || !api?.onDesignerGenerateEvent) {
      setGenerateGlobalError("生成服务不可用，请重启软件后重试");
      return;
    }
    if (!primaryUploadFile) {
      setGenerateGlobalError("缺产品图");
      return;
    }
    if (!productIdentity || imagePrompts.length === 0) {
      setGenerateGlobalError("缺 productIdentity 或 imagePrompts");
      return;
    }

    // 取被勾选的 slot，并应用 prompt override
    const selected = imagePrompts
      .filter((p) => enabledSlots.has(p.slot))
      .map((p) => ({
        ...p,
        prompt: getEffectivePrompt(p.slot, p.prompt),
      }));
    if (selected.length === 0) {
      setGenerateGlobalError("请至少勾选 1 张 slot");
      return;
    }

    setGenerating(true);
    setGenerateGlobalError(null);
    setStep(3);

    // 重置勾选 slot 的状态为 generating（即将开始）
    setSlotStates((prev) => {
      const next = new Map(prev);
      for (const p of selected) {
        next.set(p.slot, { slot: p.slot, status: "idle" });
      }
      return next;
    });

    // 订阅 SSE 事件
    const unsub = api.onDesignerGenerateEvent((payload: any) => {
      if (!payload || typeof payload !== "object") return;
      // payload: { jobId, type: "started"|"event"|"done"|"cancelled"|"error", event?, error? }
      if (payload.type === "started") return;
      if (payload.type === "done") {
        setGenerating(false);
        return;
      }
      if (payload.type === "cancelled") {
        setGenerating(false);
        return;
      }
      if (payload.type === "error") {
        setGenerateGlobalError(String(payload.error || "SSE 流出错"));
        setGenerating(false);
        return;
      }
      if (payload.type === "event") {
        const ev = payload.event;
        if (!ev || typeof ev !== "object") return;
        if (ev.status === "start" || ev.status === "complete") return;
        const slot = Number(ev.slot);
        if (!Number.isInteger(slot)) return;
        setSlotStates((prev) => {
          const next = new Map(prev);
          next.set(slot, {
            slot,
            status:
              ev.status === "generating"
                ? "generating"
                : ev.status === "success"
                ? "success"
                : ev.status === "error"
                ? "error"
                : "idle",
            dataUrl: typeof ev.dataUrl === "string" ? ev.dataUrl : undefined,
            error: typeof ev.error === "string" ? ev.error : undefined,
            bytes: typeof ev.bytes === "number" ? ev.bytes : undefined,
          });
          return next;
        });
      }
    });
    eventUnsubRef.current = unsub;

    try {
      const productImageBase64 = await readFileAsDataUrl(primaryUploadFile);
      const res = await api.designerGenerateStart({
        imagePrompts: selected,
        productIdentity,
        productImageBase64,
      });
      if (res?.jobId) setGenerateJobId(res.jobId);
    } catch (err) {
      setGenerateGlobalError(err instanceof Error ? err.message : String(err));
      setGenerating(false);
    }
  };

  const handleCancelGenerate = async () => {
    if (generateJobId && api?.designerGenerateCancel) {
      await api.designerGenerateCancel(generateJobId);
    }
    setGenerating(false);
  };

  // 单张重画：只发这一张到 SSE
  const handleRegenerateSlot = async (slot: number) => {
    const target = imagePrompts.find((p) => p.slot === slot);
    if (!target) return;
    if (!api?.designerGenerateStart) return;
    if (!primaryUploadFile) return;

    // 标记单张 generating
    setSlotStates((prev) => {
      const next = new Map(prev);
      next.set(slot, { slot, status: "generating" });
      return next;
    });

    try {
      const productImageBase64 = await readFileAsDataUrl(primaryUploadFile);
      // 不复用主 SSE，单独起一个
      let unsub: null | (() => void) = null;
      const finished = new Promise<void>((resolve) => {
        unsub = api.onDesignerGenerateEvent((payload: any) => {
          if (payload?.type === "event" && payload.event?.slot === slot) {
            const ev = payload.event;
            setSlotStates((prev) => {
              const next = new Map(prev);
              next.set(slot, {
                slot,
                status:
                  ev.status === "success"
                    ? "success"
                    : ev.status === "error"
                    ? "error"
                    : "generating",
                dataUrl: typeof ev.dataUrl === "string" ? ev.dataUrl : undefined,
                error: typeof ev.error === "string" ? ev.error : undefined,
                bytes: typeof ev.bytes === "number" ? ev.bytes : undefined,
              });
              return next;
            });
          }
          if (payload?.type === "done" || payload?.type === "error" || payload?.type === "cancelled") {
            unsub?.();
            resolve();
          }
        });
      });
      const promptText = getEffectivePrompt(slot, target.prompt);
      await api.designerGenerateStart({
        imagePrompts: [{ ...target, prompt: promptText }],
        productIdentity,
        productImageBase64,
      });
      await finished;
    } catch (err) {
      setSlotStates((prev) => {
        const next = new Map(prev);
        next.set(slot, {
          slot,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
        return next;
      });
    }
  };

  useEffect(() => {
    return () => {
      eventUnsubRef.current?.();
    };
  }, []);

  /* ============================================================
   * 渲染
   * ========================================================== */

  const successCount = useMemo(
    () => Array.from(slotStates.values()).filter((s) => s.status === "success").length,
    [slotStates]
  );
  const errorCount = useMemo(
    () => Array.from(slotStates.values()).filter((s) => s.status === "error").length,
    [slotStates]
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Stepper step={step} setStep={setStep} hasOps={!!opsBrief} hasPrompts={imagePrompts.length > 0} />

      {step === 0 && (
        <Step0Upload
          hasFile={!!primaryUploadFile}
          analyzing={analyzing}
          canAnalyze={canAnalyze}
          onAnalyze={handleAnalyze}
          error={analyzeError}
        />
      )}

      {step === 1 && opsBrief && (
        <Step1OpsBrief
          opsBrief={opsBrief}
          onChange={setOpsBrief}
          planning={planning}
          canPlan={canPlan}
          onPlan={handlePlan}
          onBack={() => setStep(0)}
          error={planError}
        />
      )}

      {step === 2 && imagePrompts.length > 0 && (
        <Step2Prompts
          productIdentity={productIdentity}
          globalForbidden={globalForbidden}
          imagePrompts={imagePrompts}
          enabledSlots={enabledSlots}
          setEnabledSlots={setEnabledSlots}
          promptOverrides={promptOverrides}
          setPromptOverrides={setPromptOverrides}
          selectedSlot={selectedSlot}
          setSelectedSlot={setSelectedSlot}
          onBack={() => setStep(1)}
          onStart={handleStartGenerate}
        />
      )}

      {step === 3 && (
        <Step3Generate
          imagePrompts={imagePrompts}
          enabledSlots={enabledSlots}
          slotStates={slotStates}
          successCount={successCount}
          errorCount={errorCount}
          generating={generating}
          generateGlobalError={generateGlobalError}
          selectedSlot={selectedSlot}
          setSelectedSlot={setSelectedSlot}
          getEffectivePrompt={getEffectivePrompt}
          promptOverrides={promptOverrides}
          setPromptOverrides={setPromptOverrides}
          onCancel={handleCancelGenerate}
          onBack={() => setStep(2)}
          onRegenerate={handleRegenerateSlot}
        />
      )}
    </div>
  );
}

/* ============================================================
 * Stepper（顶部进度条）
 * ========================================================== */

function Stepper({
  step,
  setStep,
  hasOps,
  hasPrompts,
}: {
  step: Step;
  setStep: (s: Step) => void;
  hasOps: boolean;
  hasPrompts: boolean;
}) {
  const items: Array<{ key: Step; label: string; clickable: boolean }> = [
    { key: 0, label: "1. 上传 + 运营 Agent 看图", clickable: true },
    { key: 1, label: "2. 审 OpsBrief（运营简报）", clickable: hasOps },
    { key: 2, label: "3. 设计师 Agent 写 prompt", clickable: hasPrompts },
    { key: 3, label: "4. 生图（SSE 流式）", clickable: hasPrompts },
  ];
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            onClick={() => it.clickable && setStep(it.key)}
            style={{
              padding: "6px 12px",
              borderRadius: 16,
              fontSize: 12,
              fontWeight: 600,
              cursor: it.clickable ? "pointer" : "not-allowed",
              background: step === it.key ? "#1e40af" : it.clickable ? "#eff6ff" : "#f1f5f9",
              color: step === it.key ? "#fff" : it.clickable ? "#1e40af" : "#94a3b8",
              border: step === it.key ? "1px solid #1e40af" : "1px solid #cbd5e1",
            }}
          >
            {it.label}
          </div>
          {i < items.length - 1 && <div style={{ color: "#cbd5e1" }}>›</div>}
        </div>
      ))}
    </div>
  );
}

/* ============================================================
 * Step 0: 上传 + 运营 Agent
 * ========================================================== */

function Step0Upload({
  hasFile,
  analyzing,
  canAnalyze,
  onAnalyze,
  error,
}: {
  hasFile: boolean;
  analyzing: boolean;
  canAnalyze: boolean;
  onAnalyze: () => void;
  error: string | null;
}) {
  return (
    <div
      style={{
        padding: 20,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>
        第 1 步：运营 Agent 看图分析
      </div>
      <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>
        Vision LLM 直接读你上传的产品图，输出 7 块运营简报（产品名 / 简介 / 怎么用 / 卖点 / 目标人群 /
        痛点 / 图片风格）。下一步你可以审核改动这份简报。
      </div>
      {!hasFile && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "#fffbeb",
            border: "1px solid #fde68a",
            fontSize: 12,
            color: "#92400e",
          }}
        >
          ⚠ 请先在主页上传产品图（第 1 张作为 reference）
        </div>
      )}
      {error && <ErrorBox text={error} />}
      <div>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canAnalyze || analyzing}
          style={{
            padding: "8px 18px",
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 8,
            border: "1px solid #1e40af",
            background: analyzing ? "#93c5fd" : "#1e40af",
            color: "#fff",
            cursor: !canAnalyze || analyzing ? "not-allowed" : "pointer",
            opacity: !canAnalyze ? 0.5 : 1,
          }}
        >
          {analyzing ? "运营 Agent 分析中…(约 30 秒)" : "▶ 开始运营 Agent 分析"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
 * Step 1: OpsBrief 审核 + 设计师 Agent
 * ========================================================== */

function Step1OpsBrief({
  opsBrief,
  onChange,
  planning,
  canPlan,
  onPlan,
  onBack,
  error,
}: {
  opsBrief: OpsBrief;
  onChange: (b: OpsBrief) => void;
  planning: boolean;
  canPlan: boolean;
  onPlan: () => void;
  onBack: () => void;
  error: string | null;
}) {
  const updateField = <K extends keyof OpsBrief>(k: K, v: OpsBrief[K]) =>
    onChange({ ...opsBrief, [k]: v });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>
        第 2 步：审 7 块运营简报（可改）
      </div>

      <CardField label="产品名称" value={opsBrief.productName} onChange={(v) => updateField("productName", v)} />
      <CardTextarea
        label="产品简介（是啥 + 做什么用）"
        value={opsBrief.productDescription}
        onChange={(v) => updateField("productDescription", v)}
        rows={3}
      />
      <CardTextarea
        label="产品怎么使用"
        value={opsBrief.howToUse}
        onChange={(v) => updateField("howToUse", v)}
        rows={2}
      />
      <CardLines
        label="产品卖点（每条一行）"
        value={opsBrief.sellingPoints}
        onChange={(v) => updateField("sellingPoints", v)}
        minRows={3}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          padding: 12,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
        }}
      >
        <CardField
          label="购买人群"
          value={opsBrief.targetAudience.buyer}
          onChange={(v) => updateField("targetAudience", { ...opsBrief.targetAudience, buyer: v })}
        />
        <CardField
          label="使用人群"
          value={opsBrief.targetAudience.user}
          onChange={(v) => updateField("targetAudience", { ...opsBrief.targetAudience, user: v })}
        />
      </div>
      <CardLines
        label="人群痛点 & 需求（每条一行）"
        value={opsBrief.painPointsAndNeeds}
        onChange={(v) => updateField("painPointsAndNeeds", v)}
        minRows={2}
      />
      <CardField label="图片风格" value={opsBrief.imageStyle} onChange={(v) => updateField("imageStyle", v)} />

      {error && <ErrorBox text={error} />}

      <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "6px 14px",
            fontSize: 13,
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          ← 上一步
        </button>
        <button
          type="button"
          onClick={onPlan}
          disabled={!canPlan || planning}
          style={{
            padding: "8px 18px",
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 8,
            border: "1px solid #1e40af",
            background: planning ? "#93c5fd" : "#1e40af",
            color: "#fff",
            cursor: !canPlan || planning ? "not-allowed" : "pointer",
            opacity: !canPlan ? 0.5 : 1,
          }}
        >
          {planning ? "设计师 Agent 写 prompt 中…(约 90 秒)" : "▶ 设计师 Agent 写 10 条 prompt"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
 * Step 2: imagePrompts 审核 + 勾选 + 起 SSE
 * ========================================================== */

function Step2Prompts({
  productIdentity,
  globalForbidden,
  imagePrompts,
  enabledSlots,
  setEnabledSlots,
  promptOverrides,
  setPromptOverrides,
  selectedSlot,
  setSelectedSlot,
  onBack,
  onStart,
}: {
  productIdentity: string;
  globalForbidden: string[];
  imagePrompts: ImagePrompt[];
  enabledSlots: Set<number>;
  setEnabledSlots: (s: Set<number>) => void;
  promptOverrides: Map<number, string>;
  setPromptOverrides: (m: Map<number, string>) => void;
  selectedSlot: number | null;
  setSelectedSlot: (s: number | null) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const toggleSlot = (slot: number) => {
    const next = new Set(enabledSlots);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    setEnabledSlots(next);
  };
  const selectAll = () => setEnabledSlots(new Set(imagePrompts.map((p) => p.slot)));
  const selectNone = () => setEnabledSlots(new Set());

  const selectedPrompt = imagePrompts.find((p) => p.slot === selectedSlot) || null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>
        第 3 步：审 10 条 prompt + 勾要生哪几张
      </div>

      <div
        style={{
          padding: 12,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af", marginBottom: 6 }}>
          Product Identity（10 张共享，锁主体）
        </div>
        <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6 }}>{productIdentity}</div>
        {globalForbidden.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#6b7280" }}>Forbidden：</span>
            {globalForbidden.map((f, i) => (
              <span
                key={i}
                style={{
                  padding: "1px 8px",
                  fontSize: 11,
                  borderRadius: 10,
                  background: "#fef2f2",
                  color: "#991b1b",
                  border: "1px solid #fecaca",
                }}
              >
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, color: "#374151" }}>
          已选 {enabledSlots.size}/{imagePrompts.length} 张
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={selectAll}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            全选
          </button>
          <button
            type="button"
            onClick={selectNone}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            全不选
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {imagePrompts.map((p) => {
          const enabled = enabledSlots.has(p.slot);
          const isSelected = selectedSlot === p.slot;
          return (
            <div
              key={p.slot}
              onClick={() => setSelectedSlot(isSelected ? null : p.slot)}
              style={{
                width: 160,
                cursor: "pointer",
                outline: isSelected ? "2px solid #3b82f6" : "none",
                outlineOffset: 2,
                borderRadius: 8,
                position: "relative",
                opacity: enabled ? 1 : 0.45,
              }}
            >
              <div
                style={{
                  width: 160,
                  height: 200,
                  borderRadius: 8,
                  border: "1px dashed #94a3b8",
                  background: "linear-gradient(135deg,#f1f5f9 0%,#e2e8f0 100%)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  padding: 8,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, color: "#334155" }}>#{p.slot}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{p.imageType}</div>
                <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 4 }}>{p.mood}</div>
              </div>
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
                #{p.slot}
              </div>
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  padding: "2px 6px",
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 4,
                  background: p.mode === "edit" ? "rgba(5,150,105,0.92)" : "rgba(217,119,6,0.92)",
                  color: "#fff",
                }}
              >
                {p.mode}
              </div>
              <label
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  bottom: 6,
                  left: 6,
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 4,
                  background: enabled ? "#10b981" : "#cbd5e1",
                  color: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleSlot(p.slot)}
                  style={{ accentColor: "#10b981" }}
                />
                {enabled ? "要生" : "跳过"}
              </label>
            </div>
          );
        })}
      </div>

      {selectedPrompt && (
        <PromptDetail
          imagePrompt={selectedPrompt}
          override={promptOverrides.get(selectedPrompt.slot) ?? selectedPrompt.prompt}
          onOverride={(v) => {
            const next = new Map(promptOverrides);
            next.set(selectedPrompt.slot, v);
            setPromptOverrides(next);
          }}
          onReset={() => {
            const next = new Map(promptOverrides);
            next.delete(selectedPrompt.slot);
            setPromptOverrides(next);
          }}
        />
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "6px 14px",
            fontSize: 13,
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          ← 上一步
        </button>
        <button
          type="button"
          onClick={onStart}
          disabled={enabledSlots.size === 0}
          style={{
            padding: "8px 18px",
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 8,
            border: "1px solid #059669",
            background: enabledSlots.size === 0 ? "#a7f3d0" : "#10b981",
            color: "#fff",
            cursor: enabledSlots.size === 0 ? "not-allowed" : "pointer",
          }}
        >
          ▶ 开始生图（{enabledSlots.size} 张并发，SSE 流）
        </button>
      </div>
    </div>
  );
}

/* ============================================================
 * Step 3: 实时 SSE 进度 + 单张重画
 * ========================================================== */

function Step3Generate({
  imagePrompts,
  enabledSlots,
  slotStates,
  successCount,
  errorCount,
  generating,
  generateGlobalError,
  selectedSlot,
  setSelectedSlot,
  getEffectivePrompt,
  promptOverrides,
  setPromptOverrides,
  onCancel,
  onBack,
  onRegenerate,
}: {
  imagePrompts: ImagePrompt[];
  enabledSlots: Set<number>;
  slotStates: Map<number, SlotState>;
  successCount: number;
  errorCount: number;
  generating: boolean;
  generateGlobalError: string | null;
  selectedSlot: number | null;
  setSelectedSlot: (s: number | null) => void;
  getEffectivePrompt: (slot: number, original: string) => string;
  promptOverrides: Map<number, string>;
  setPromptOverrides: (m: Map<number, string>) => void;
  onCancel: () => void;
  onBack: () => void;
  onRegenerate: (slot: number) => void;
}) {
  const total = enabledSlots.size;
  const selectedPrompt = imagePrompts.find((p) => p.slot === selectedSlot) || null;
  const selectedState = selectedSlot != null ? slotStates.get(selectedSlot) : undefined;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>
          第 4 步：生图（实时进度）
        </div>
        <div style={{ fontSize: 13, color: "#374151" }}>
          完成 {successCount}/{total} {errorCount > 0 ? `· 失败 ${errorCount}` : ""}{" "}
          {generating ? "（流式中…）" : ""}
        </div>
      </div>

      {generateGlobalError && <ErrorBox text={generateGlobalError} />}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {imagePrompts
          .filter((p) => enabledSlots.has(p.slot))
          .map((p) => {
            const st: SlotState = slotStates.get(p.slot) || { slot: p.slot, status: "idle" };
            const isSelected = selectedSlot === p.slot;
            return (
              <div
                key={p.slot}
                onClick={() => setSelectedSlot(isSelected ? null : p.slot)}
                style={{
                  width: 160,
                  cursor: "pointer",
                  outline: isSelected ? "2px solid #3b82f6" : "none",
                  outlineOffset: 2,
                  borderRadius: 8,
                  position: "relative",
                }}
              >
                {st.status === "success" && st.dataUrl ? (
                  <img
                    src={st.dataUrl}
                    alt={`slot-${p.slot}`}
                    style={{
                      width: 160,
                      height: 200,
                      objectFit: "cover",
                      borderRadius: 8,
                      display: "block",
                      background: "#f3f4f6",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 160,
                      height: 200,
                      borderRadius: 8,
                      border: "1px dashed #94a3b8",
                      background:
                        st.status === "error"
                          ? "#fef2f2"
                          : st.status === "generating"
                          ? "linear-gradient(135deg,#fef3c7 0%,#fde68a 100%)"
                          : "linear-gradient(135deg,#f1f5f9 0%,#e2e8f0 100%)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      alignItems: "center",
                      padding: 8,
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#334155" }}>#{p.slot}</div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{p.imageType}</div>
                    <div
                      style={{
                        fontSize: 11,
                        marginTop: 8,
                        color:
                          st.status === "error"
                            ? "#b91c1c"
                            : st.status === "generating"
                            ? "#92400e"
                            : "#94a3b8",
                        fontWeight: 600,
                      }}
                    >
                      {st.status === "generating"
                        ? "生成中…"
                        : st.status === "error"
                        ? "✗ 失败"
                        : "等待"}
                    </div>
                    {st.status === "error" && st.error && (
                      <div
                        style={{
                          fontSize: 9,
                          color: "#b91c1c",
                          marginTop: 4,
                          padding: "0 6px",
                          wordBreak: "break-word",
                        }}
                      >
                        {st.error.slice(0, 60)}
                      </div>
                    )}
                  </div>
                )}
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
                  #{p.slot} {p.imageType}
                </div>
                <div
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    padding: "2px 6px",
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 4,
                    background: p.mode === "edit" ? "rgba(5,150,105,0.92)" : "rgba(217,119,6,0.92)",
                    color: "#fff",
                  }}
                >
                  {p.mode}
                </div>
              </div>
            );
          })}
      </div>

      {selectedPrompt && (
        <div
          style={{
            border: "1px solid #bfdbfe",
            borderRadius: 12,
            padding: 16,
            background: "#eff6ff",
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1e3a8a" }}>
              Slot {selectedPrompt.slot} · {selectedPrompt.imageType} · {selectedPrompt.mode} ·{" "}
              {selectedPrompt.cameraAngle} · mood: {selectedPrompt.mood}
            </div>
            <button
              type="button"
              onClick={() => onRegenerate(selectedPrompt.slot)}
              disabled={selectedState?.status === "generating"}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: "1px solid #059669",
                background: selectedState?.status === "generating" ? "#6ee7b7" : "#10b981",
                color: "#fff",
                cursor: selectedState?.status === "generating" ? "not-allowed" : "pointer",
              }}
            >
              {selectedState?.status === "generating" ? "生成中…" : "🔄 重生这张"}
            </button>
          </div>

          <div style={{ fontSize: 12, color: "#374151" }}>
            <strong>场景：</strong>
            {selectedPrompt.sceneDescription}
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1e3a8a", marginBottom: 4 }}>
              完整 prompt（可改完点重生）
            </div>
            <textarea
              value={getEffectivePrompt(selectedPrompt.slot, selectedPrompt.prompt)}
              onChange={(e) => {
                const next = new Map(promptOverrides);
                next.set(selectedPrompt.slot, e.target.value);
                setPromptOverrides(next);
              }}
              style={{
                width: "100%",
                minHeight: 160,
                padding: 10,
                fontSize: 12,
                fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                resize: "vertical",
                lineHeight: 1.5,
              }}
            />
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          type="button"
          onClick={onBack}
          disabled={generating}
          style={{
            padding: "6px 14px",
            fontSize: 13,
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: generating ? "not-allowed" : "pointer",
            opacity: generating ? 0.5 : 1,
          }}
        >
          ← 上一步
        </button>
        {generating && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid #dc2626",
              background: "#fff",
              color: "#b91c1c",
              cursor: "pointer",
            }}
          >
            ✕ 取消生图
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * 小组件
 * ========================================================== */

function CardField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        padding: 12,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af", marginBottom: 4 }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: 6,
          fontSize: 13,
          border: "1px solid #cbd5e1",
          borderRadius: 4,
        }}
      />
    </div>
  );
}

function CardTextarea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div
      style={{
        padding: 12,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af", marginBottom: 4 }}>{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        style={{
          width: "100%",
          padding: 6,
          fontSize: 13,
          border: "1px solid #cbd5e1",
          borderRadius: 4,
          resize: "vertical",
        }}
      />
    </div>
  );
}

function CardLines({
  label,
  value,
  onChange,
  minRows = 3,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  minRows?: number;
}) {
  const text = value.join("\n");
  return (
    <div
      style={{
        padding: 12,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af", marginBottom: 4 }}>
        {label}（{value.length} 条）
      </div>
      <textarea
        value={text}
        onChange={(e) =>
          onChange(
            e.target.value
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
          )
        }
        rows={Math.max(minRows, Math.min(value.length + 1, 8))}
        style={{
          width: "100%",
          padding: 6,
          fontSize: 13,
          border: "1px solid #cbd5e1",
          borderRadius: 4,
          resize: "vertical",
        }}
      />
    </div>
  );
}

function PromptDetail({
  imagePrompt,
  override,
  onOverride,
  onReset,
}: {
  imagePrompt: ImagePrompt;
  override: string;
  onOverride: (v: string) => void;
  onReset: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid #bfdbfe",
        borderRadius: 12,
        padding: 16,
        background: "#eff6ff",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: "#1e3a8a" }}>
        Slot {imagePrompt.slot} · {imagePrompt.imageType} · {imagePrompt.mode} ·{" "}
        {imagePrompt.cameraAngle} · mood: {imagePrompt.mood}
      </div>
      <div style={{ fontSize: 12, color: "#374151" }}>
        <strong>场景：</strong>
        {imagePrompt.sceneDescription}
      </div>
      <textarea
        value={override}
        onChange={(e) => onOverride(e.target.value)}
        style={{
          width: "100%",
          minHeight: 160,
          padding: 10,
          fontSize: 12,
          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          border: "1px solid #cbd5e1",
          borderRadius: 6,
          resize: "vertical",
          lineHeight: 1.5,
        }}
      />
      {override !== imagePrompt.prompt && (
        <button
          type="button"
          onClick={onReset}
          style={{
            alignSelf: "flex-start",
            padding: "3px 10px",
            fontSize: 11,
            border: "1px solid #cbd5e1",
            borderRadius: 4,
            background: "#fff",
            cursor: "pointer",
            color: "#6b7280",
          }}
        >
          还原为 AI 原版
        </button>
      )}
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: 8,
        fontSize: 12,
        color: "#b91c1c",
      }}
    >
      ✗ {text}
    </div>
  );
}
