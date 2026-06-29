/**
 * AI 生图（多 agent / Supervisor 版）
 *
 * 三步交互：
 *   1) 配置：上传商品图 → 选市场/尺寸/图类型
 *   2) 方案：启动 9-agent 流水线（stopAtPhase=review_passed），跑到「方案就绪」停住，
 *      展示每张图方案（分镜/场景/卖点/prompt）供确认
 *   3) 生图：确认后走 /api/agent/regen 把方案里的 imagePrompts 逐张生成
 *
 * 后端是异步 job + 落盘 + 轮询模型（非 SSE）。/api/agent/* 走云端 erp.temu.chat。
 * UI：复用全局设计 token（tokens.css）与 studio-* 设计语言，样式见 imageStudioAgent.css。
 */
import { useEffect, useRef, useState } from "react";
import {
  IMAGE_LANGUAGE_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  IMAGE_TYPE_LABELS,
  DEFAULT_IMAGE_TYPES,
  getDefaultImageLanguageForRegion,
  normalizeDimensionTextDualUnit,
} from "../utils/imageStudio";
import "../styles/imageStudioAgent.css";

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
  storyboard?: unknown[];
  imagePrompts?: unknown[];
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

// 方案里的单张图（storyboard shot + 关联的 finalPrompt）
interface PlanShot {
  order: number;
  shotType?: string;
  imageGroup?: string;
  subject?: string;
  scene?: string;
  taskStatement?: string;
  answersQuestions?: string[];
  finalPrompt?: string;
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

// state.step（PipelineStep 状态机）→ 中文
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
  review_passed: "方案已就绪",
  review_stuck: "审阅未收敛，需人工介入",
  images_generated: "生图完成",
  completed: "全部完成",
};

// 规划阶段的终态（跑到这些 step 就停，等用户确认/收尾）
const PLAN_STOP_STEP = "review_passed";
const FAIL_STEPS = new Set(["review_stuck"]);
const DONE_STEPS = new Set(["images_generated", "completed"]);
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

// 从 dataUrl 头部判断扩展名，用于下载命名（main 图多为 png，其余 jpeg）
function dataUrlExt(url: string): string {
  if (url.startsWith("data:image/jpeg") || url.startsWith("data:image/jpg")) return "jpg";
  if (url.startsWith("data:image/webp")) return "webp";
  return "png";
}

/* ---- note 降噪分类：区分心跳/技术噪音/关键决策/真产出，让面板只显示有用信息 ---- */
// 「…已等待 120s」这类进行中心跳，会反复刷屏
function isHeartbeatNote(note: string): boolean {
  return /已等待\s*\d+\s*s/.test(note);
}
// 用户该知道的关键决策/告警（一次性，非心跳）
function isKeyNote(note: string): boolean {
  return (
    !isHeartbeatNote(note) &&
    /(不符契约|按硬约束重做|未收敛|审阅[^。]*(未|不)通过|生图失败|stuck|critical|需人工)/.test(note)
  );
}
// 技术调试：内联 JSON / metric 英文字段 / asset 内部细节，运营看不懂
function isTechNote(note: string): boolean {
  return (
    /\{[^}]*["':][^}]*\}/.test(note) ||
    /(foregroundratio|componentcount|candidaterejection|info_board|cleanliness|productref|asset_[a-z]|rejected|metric)/i.test(note)
  );
}
// 信号 note（左栏每步 + 右栏「只看关键」都用）：留关键决策与真产出，滤掉心跳与技术噪音
function isSignalNote(note: string): boolean {
  if (isKeyNote(note)) return true;
  if (isHeartbeatNote(note) || isTechNote(note)) return false;
  return true;
}

// 从 poll 拿到的 state 解析出方案（storyboard + 关联 finalPrompt）
function parsePlanShots(state: SupervisorState | null): PlanShot[] {
  const sb = Array.isArray(state?.storyboard) ? (state!.storyboard as any[]) : [];
  if (sb.length === 0) return [];
  const ips = Array.isArray(state?.imagePrompts) ? (state!.imagePrompts as any[]) : [];
  const promptByOrder = new Map<number, string>();
  for (const p of ips) {
    if (p && typeof p.shotOrder === "number") promptByOrder.set(p.shotOrder, String(p.finalPrompt || ""));
  }
  return sb.map((s: any): PlanShot => {
    const order = typeof s?.order === "number" ? s.order : 0;
    return {
      order,
      shotType: typeof s?.shotType === "string" ? s.shotType : undefined,
      imageGroup: typeof s?.imageGroup === "string" ? s.imageGroup : undefined,
      subject: typeof s?.subject === "string" ? s.subject : undefined,
      scene: typeof s?.scene === "string" ? s.scene : undefined,
      taskStatement: typeof s?.taskStatement === "string" ? s.taskStatement : undefined,
      answersQuestions: Array.isArray(s?.answersQuestions)
        ? s.answersQuestions.filter((q: unknown): q is string => typeof q === "string")
        : [],
      finalPrompt: promptByOrder.get(order),
    };
  });
}

/* ============================ 主组件 ============================ */

export default function ImageStudioAgent() {
  const [view, setView] = useState<"config" | "workflow">("config");
  const [productFiles, setProductFiles] = useState<File[]>([]);
  const [competitorFiles, setCompetitorFiles] = useState<File[]>([]);
  const [salesRegion, setSalesRegion] = useState("us");
  // 图片语言绑定地区：由所选市场直接派生，不再单独选择，杜绝地区与语言不一致
  const imageLanguage = getDefaultImageLanguageForRegion(salesRegion);
  // 出图设置：尺寸单选 + 图类型多选（默认全选）
  const [imageSize, setImageSize] = useState<string>("1200x1200");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([...DEFAULT_IMAGE_TYPES]);

  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState<string>("");
  const [pipelineStep, setPipelineStep] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [images, setImages] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [previewSlot, setPreviewSlot] = useState<number | null>(null);

  // 方案确认门
  const [planReady, setPlanReady] = useState(false); // 流水线已跑到「方案就绪」，等用户确认
  const [confirmedGen, setConfirmedGen] = useState(false); // 用户已确认进入生图
  const [planShots, setPlanShots] = useState<PlanShot[]>([]);
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number>(0);
  const fetchingSlots = useRef<Set<number>>(new Set());
  const gotSlots = useRef<Set<number>>(new Set());
  const cancelledRef = useRef(false);
  const productRefsRef = useRef<string[]>([]); // 商品图 dataUrl，regen 续跑生图要用
  const confirmedGenRef = useRef(false); // poll 闭包里读最新确认状态

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

  // 大图预览：Esc 关闭
  useEffect(() => {
    if (previewSlot === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewSlot(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewSlot]);

  const toggleType = (t: string) =>
    setSelectedTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  const allTypesSelected = selectedTypes.length === DEFAULT_IMAGE_TYPES.length;

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
      setStatusText(`轮询出错，重试中：${err instanceof Error ? err.message : String(err)}`);
      pollTimer.current = setTimeout(() => poll(jid), POLL_INTERVAL_MS);
      return;
    }

    if (Array.isArray(result?.logs)) setLogs(result.logs);

    // 解析方案（storyboard 逐步出现，方案就绪时齐全）
    const shots = parsePlanShots(result?.state ?? null);
    if (shots.length > 0) setPlanShots(shots);

    const step = result?.state?.step || "";
    if (step) {
      setPipelineStep(step);
      setStatusText(PIPELINE_STEP_LABELS[step] || step);
    }

    // 确认生图后才拉图（规划阶段不出图）
    if (confirmedGenRef.current) {
      const slots = Array.isArray(result?.generatedSlotOrders) ? result.generatedSlotOrders : [];
      for (const slot of slots) void fetchSlotImage(jid, slot);
    }

    // 规划阶段跑到「方案就绪」→ 停下等用户确认
    if (step === PLAN_STOP_STEP && !confirmedGenRef.current) {
      stopPolling();
      setRunning(false);
      setPlanReady(true);
      setStatusText("方案已就绪，请确认");
      return;
    }
    // 审阅未收敛 → 停（显示告警）
    if (FAIL_STEPS.has(step)) {
      stopPolling();
      setRunning(false);
      return;
    }
    // 确认生图后跑完 → 停
    if (confirmedGenRef.current && DONE_STEPS.has(step)) {
      stopPolling();
      setRunning(false);
      setStatusText("生图完成");
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
    if (selectedTypes.length === 0) {
      setError("请至少选择 1 种要生成的图类型");
      return;
    }

    // 重置
    cancelledRef.current = false;
    confirmedGenRef.current = false;
    stopPolling();
    setError(null);
    setLogs([]);
    setImages(new Map());
    gotSlots.current = new Set();
    fetchingSlots.current = new Set();
    setJobId(null);
    setPipelineStep("");
    setPlanReady(false);
    setConfirmedGen(false);
    setPlanShots([]);
    setExpandedOrder(null);
    setRunning(true);
    setView("workflow"); // 点生成即跳转工作流屏
    startedAt.current = Date.now();
    setElapsed(0);

    try {
      // 1) analyze 出 AnalysisResult
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
      if (typeof analysis.estimatedDimensions === "string") {
        analysis.estimatedDimensions = normalizeDimensionTextDualUnit(analysis.estimatedDimensions);
      }
      if (analysis.productFacts && typeof analysis.productFacts.estimatedDimensions === "string") {
        analysis.productFacts.estimatedDimensions = normalizeDimensionTextDualUnit(analysis.productFacts.estimatedDimensions);
      }

      // 2) 启动 9-agent Supervisor，跑到「方案就绪」停（stopAtPhase=review_passed）
      setStatusText("正在启动 9-agent 流水线…");
      const productReferences = await Promise.all(productFiles.map(fileToDataUrl));
      productRefsRef.current = productReferences; // 存下来，确认生图时给 regen
      const competitorImages = competitorFiles.length
        ? await Promise.all(competitorFiles.map(fileToDataUrl))
        : undefined;

      const startRes = await api.supervisorStart({
        analysis,
        productReferences,
        competitorImages,
        stopAtPhase: "review_passed", // 先出方案、不生图，等用户确认
        salesRegion,
        imageLanguage,
        imageSize,
        // 传中文图类型标签，云端各 agent 的中文 prompt 更易理解并遵守
        imageTypes: selectedTypes.map((k) => IMAGE_TYPE_LABELS[k] || k),
      });
      const jid = startRes?.jobId;
      if (!jid) throw new Error(startRes?.error ? String(startRes.error) : "启动失败，未拿到 jobId");
      setJobId(jid);
      setStatusText("流水线已启动，正在规划方案…");

      poll(jid);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
      stopPolling();
    }
  };

  // 用户确认方案 → 走 regen 把方案里的 prompt 逐张生成
  const handleConfirmGenerate = async () => {
    if (!jobId || !api?.supervisorRegen) {
      setError("生图服务不可用，请重启软件后重试");
      return;
    }
    const shots = planShots.map((s) => s.order).filter((n) => Number.isInteger(n));
    if (shots.length === 0) {
      setError("方案为空，无法生图");
      return;
    }
    setError(null);
    cancelledRef.current = false;
    confirmedGenRef.current = true;
    setConfirmedGen(true);
    setPlanReady(false);
    setRunning(true);
    startedAt.current = Date.now();
    setElapsed(0);
    setStatusText("正在按方案生图…");
    try {
      const res = await api.supervisorRegen({
        jobId,
        shots,
        productReferences: productRefsRef.current,
      });
      if (res?.error) throw new Error(String(res.error));
      poll(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
      confirmedGenRef.current = false;
      setConfirmedGen(false);
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
  // 按 agent(step) 聚合各自产出的 note，挂到对应进度步骤下显示
  const notesByStep = new Map<string, string[]>();
  for (const l of logs) {
    const note = (l.note || "").trim();
    if (!note) continue;
    const arr = notesByStep.get(l.step);
    if (arr) arr.push(note);
    else notesByStep.set(l.step, [note]);
  }
  const orderedImages = Array.from(images.entries()).sort((a, b) => a[0] - b[0]);
  const stepKeys = Object.keys(STEP_LABELS).filter((k) => k !== "supervisor");
  const activeStepKey = running ? stepKeys.find((k) => !reachedSteps.has(k)) : undefined;
  const previewUrl = previewSlot !== null ? images.get(previewSlot) ?? null : null;
  const currentRegionLabel = REGION_CARDS.find((r) => r.value === salesRegion)?.label || salesRegion;
  const currentLanguageLabel =
    IMAGE_LANGUAGE_OPTIONS.find((o) => o.value === imageLanguage)?.label || imageLanguage;
  const showPlan = planReady && !confirmedGen; // 工作流屏当前是否展示「方案确认」

  return (
    <div className="isa-shell">
      {view === "config" ? (
        <>
          {/* 页头 */}
          <header className="isa-hero">
            <div className="isa-hero__eyebrow">AI 工作流</div>
            <div className="isa-hero__title">AI 生图 · 多 Agent 版</div>
            <div className="isa-hero__desc">
              9 个角色 agent 接力协作：产品总监 → 商业策略 → 淘宝运营 → 创意 → 品牌 → 素材库 → 分镜 →
              文案 → 摄影 → 全员审阅。先出方案给你确认，确认后再生图。
            </div>
            <div className="isa-hero__pills">
              <span className="isa-pill">
                <span className="isa-pill__dot" />9 Agent 协作
              </span>
              <span className="isa-pill">
                <span className="isa-pill__dot isa-pill__dot--green" />先方案后生图
              </span>
              <span className="isa-pill">
                <span className="isa-pill__dot isa-pill__dot--purple" />单次约 8–15 分钟
              </span>
            </div>
          </header>

          {/* 上传区 */}
          <div className="isa-uploads">
            <UploadCard
              title="商品图"
              badge="必填"
              variant="primary"
              hint="可多张多角度，越全 agent 越懂你的品。"
              files={productFiles}
              onChange={setProductFiles}
              disabled={running}
            />
            <UploadCard
              title="竞品图"
              badge="可选"
              variant="optional"
              hint="供 9 个 agent 参考学习、对标竞品风格。"
              files={competitorFiles}
              onChange={setCompetitorFiles}
              disabled={running}
            />
          </div>

          {/* 目标市场 */}
          <section className="isa-panel">
            <div className="isa-panel__head">
              <div>
                <div className="isa-eyebrow">目标市场</div>
                <div className="isa-panel__title">选择投放市场</div>
              </div>
            </div>

            <div className="isa-region-grid">
              {REGION_CARDS.map((region) => {
                const isSelected = salesRegion === region.value;
                return (
                  <button
                    key={region.value}
                    type="button"
                    disabled={running}
                    onClick={() => setSalesRegion(region.value)}
                    className={`studio-region-card${isSelected ? " is-selected" : ""}`}
                  >
                    <div className="studio-region-card__code">{region.code}</div>
                    <div className="studio-region-card__label">{region.label}</div>
                  </button>
                );
              })}
            </div>

            <div className="isa-summary">
              当前：<strong>{currentRegionLabel}</strong> 市场 · 图上文案语言{" "}
              <strong>{currentLanguageLabel}</strong>
            </div>
          </section>

          {/* 出图设置：尺寸 + 图类型 */}
          <section className="isa-panel">
            <div className="isa-panel__head">
              <div>
                <div className="isa-eyebrow">出图设置</div>
                <div className="isa-panel__title">尺寸与图类型</div>
              </div>
            </div>

            {/* 尺寸 */}
            <div>
              <div className="isa-subhead">图片尺寸</div>
              <div className="isa-size-row">
                {IMAGE_SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={running}
                    onClick={() => setImageSize(opt.value)}
                    className={`isa-size-chip${imageSize === opt.value ? " is-selected" : ""}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 图类型多选 */}
            <div>
              <div className="isa-subhead">
                <span>生成哪些图</span>
                <span className="isa-subhead__meta">
                  已选 {selectedTypes.length} / {DEFAULT_IMAGE_TYPES.length}
                  <button
                    type="button"
                    className="isa-link-btn"
                    disabled={running}
                    onClick={() => setSelectedTypes(allTypesSelected ? [] : [...DEFAULT_IMAGE_TYPES])}
                  >
                    {allTypesSelected ? "全不选" : "全选"}
                  </button>
                </span>
              </div>
              <div className="isa-type-grid">
                {DEFAULT_IMAGE_TYPES.map((t) => {
                  const on = selectedTypes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={running}
                      onClick={() => toggleType(t)}
                      className={`isa-type-chip${on ? " is-selected" : ""}`}
                    >
                      <span className="isa-type-chip__check">✓</span>
                      {IMAGE_TYPE_LABELS[t] || t}
                    </button>
                  );
                })}
              </div>
              <div className="isa-type-hint">
                作为给 agent 团队的「出图范围」约束；最终张数仍由淘宝运营 / 分镜 agent 按品类规划。
              </div>
            </div>
          </section>

          {/* 操作区 */}
          <div className="isa-actions">
            {running ? (
              <button type="button" className="isa-cta" onClick={() => setView("workflow")}>
                查看进度 →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={productFiles.length === 0 || selectedTypes.length === 0}
                title={
                  productFiles.length === 0
                    ? "请先上传至少 1 张商品图"
                    : selectedTypes.length === 0
                      ? "请至少选择 1 种图类型"
                      : undefined
                }
                className="isa-cta"
              >
                <span aria-hidden>▶</span> 生成方案 · 9 Agent
              </button>
            )}
            {!running && productFiles.length === 0 && (
              <span className="isa-hint-text">上传商品图后即可开始</span>
            )}
            {!running && productFiles.length > 0 && selectedTypes.length === 0 && (
              <span className="isa-hint-text">请至少选 1 种要生成的图</span>
            )}
          </div>

          {error && <div className="isa-alert isa-alert--error">{error}</div>}
        </>
      ) : (
        <>
          {/* 工作流屏头部 */}
          <div className="isa-workflow-head">
            <button type="button" className="isa-back" onClick={() => setView("config")}>
              ← 返回配置
            </button>
            <div className="isa-workflow-head__main">
              <div className="isa-workflow-head__title">
                {showPlan ? "生图方案确认" : confirmedGen ? "生图执行" : "Agent 工作流"}
              </div>
              <div className="isa-workflow-head__sub">
                {currentRegionLabel} 市场 · {imageSize}
                {planShots.length > 0 ? ` · 方案 ${planShots.length} 张` : ` · 计划 ${selectedTypes.length} 类图`}
              </div>
            </div>
            <div className="isa-workflow-head__right">
              {running ? (
                <>
                  <span className="isa-runmeta">
                    <span className="isa-runmeta__time">⏱ {fmtElapsed(elapsed)}</span>
                    <span>·</span>
                    <span>{statusText}</span>
                  </span>
                  <button type="button" onClick={handleCancel} className="isa-cta isa-cta--cancel">
                    停止
                  </button>
                </>
              ) : (
                <span
                  className={`isa-done-text${pipelineStep === "completed" || pipelineStep === "images_generated" ? " is-success" : ""}`}
                >
                  {statusText || "已停止"}
                </span>
              )}
              {images.size > 0 && <span className="isa-count">已出图 {images.size} 张</span>}
            </div>
          </div>

          {error && <div className="isa-alert isa-alert--error">{error}</div>}

          {pipelineStep === "review_stuck" && (
            <div className="isa-alert isa-alert--warn">
              审阅环未收敛（critical 问题未清零或达迭代上限），流水线停在审阅阶段，未产出方案。可返回配置调整后重试。
            </div>
          )}

          {showPlan ? (
            /* ===== 方案就绪：展示方案 + 确认门 ===== */
            <PlanReview
              shots={planShots}
              expandedOrder={expandedOrder}
              onToggleExpand={(o) => setExpandedOrder(expandedOrder === o ? null : o)}
              onConfirm={handleConfirmGenerate}
              onBack={() => setView("config")}
            />
          ) : (
            /* ===== 规划中 / 生图中：进度 + 出图 ===== */
            <div className={`isa-work${confirmedGen ? " isa-work--split" : ""}`}>
              {/* 主体：Agent 流程——每个 agent 一块，按流程顺序展示状态 + 输出 */}
              <div className="isa-card isa-flowcol">
                <div className="isa-section-label">Agent 流程</div>
                <div className="isa-flow">
                  {Object.entries(STEP_LABELS).map(([key, label]) => {
                    if (key === "supervisor") return null;
                    const done = reachedSteps.has(key);
                    const active = key === activeStepKey;
                    const outputs = (notesByStep.get(key) || []).filter(isSignalNote);
                    const status = done ? "完成" : active ? "进行中" : "待开始";
                    return (
                      <div
                        key={key}
                        className={`isa-flow-node${done ? " is-done" : ""}${active ? " is-active" : ""}`}
                      >
                        <div className="isa-flow-node__head">
                          <span className="isa-flow-node__mark">✓</span>
                          <span className="isa-flow-node__title">{label}</span>
                          <span className="isa-flow-node__status">{status}</span>
                        </div>
                        {outputs.length > 0 ? (
                          <div className="isa-flow-node__body">
                            {outputs.map((note, i) => (
                              <div
                                key={i}
                                className={`isa-flow-node__output${isKeyNote(note) ? " is-key" : ""}`}
                              >
                                {note}
                              </div>
                            ))}
                          </div>
                        ) : active ? (
                          <div className="isa-flow-node__body">
                            <div className="isa-flow-node__pending">正在处理…</div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 生图阶段：右侧生成结果 */}
              {confirmedGen && (
                <div className="isa-card isa-resultcol">
                  <div className="isa-card__title">生成结果（{images.size} 张）</div>
                  {orderedImages.length === 0 ? (
                    <div className="isa-empty">生图阶段会逐张出现在这里…</div>
                  ) : (
                    <div className="isa-shots">
                      {orderedImages.map(([slot, dataUrl]) => (
                        <button
                          key={slot}
                          type="button"
                          className="isa-shot"
                          onClick={() => setPreviewSlot(slot)}
                          title="点击查看大图"
                        >
                          <img src={dataUrl} alt={`slot-${slot}`} className="isa-shot__img" />
                          <span className="isa-shot__tag">#{slot}</span>
                          <span className="isa-shot__overlay">查看大图</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {previewSlot !== null && previewUrl && (
        <div className="isa-lightbox" onClick={() => setPreviewSlot(null)}>
          <div className="isa-lightbox__body" onClick={(e) => e.stopPropagation()}>
            <img className="isa-lightbox__img" src={previewUrl} alt={`第 ${previewSlot} 张`} />
            <div className="isa-lightbox__bar">
              <span className="isa-lightbox__title">第 {previewSlot} 张</span>
              <div className="isa-lightbox__actions">
                <a
                  className="isa-btn"
                  href={previewUrl}
                  download={`temu-agent-${previewSlot}.${dataUrlExt(previewUrl)}`}
                >
                  下载
                </a>
                <button type="button" className="isa-btn" onClick={() => setPreviewSlot(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================ 方案确认 ============================ */

function PlanReview({
  shots,
  expandedOrder,
  onToggleExpand,
  onConfirm,
  onBack,
}: {
  shots: PlanShot[];
  expandedOrder: number | null;
  onToggleExpand: (order: number) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <section className="isa-plan">
      <div className="isa-plan__head">
        <div>
          <div className="isa-eyebrow">方案就绪</div>
          <div className="isa-panel__title">生图方案 · 共 {shots.length} 张</div>
          <div className="isa-plan__hint">
            9 个 agent 已规划好每张图。确认后进入生图（约 8–15 分钟）；不满意可返回配置调整重来。
          </div>
        </div>
        <div className="isa-plan__actions">
          <button type="button" className="isa-btn" onClick={onBack}>
            ← 返回调整
          </button>
          <button type="button" className="isa-cta" onClick={onConfirm} disabled={shots.length === 0}>
            <span aria-hidden>▶</span> 确认生图 · {shots.length} 张
          </button>
        </div>
      </div>

      <div className="isa-plan-grid">
        {shots.map((shot) => {
          const title = [shot.shotType, shot.imageGroup].filter(Boolean).join(" · ") || "出图";
          const expanded = expandedOrder === shot.order;
          return (
            <div key={shot.order} className="studio-plan-card">
              <div className="isa-plan-card__head">
                <span className="isa-plan-card__index">{shot.order}</span>
                <span className="isa-plan-card__title">{title}</span>
              </div>
              <div className="studio-plan-preview">
                <div className="studio-plan-preview__summary">
                  <div className="studio-plan-preview__eyebrow">这张图</div>
                  <div className="studio-plan-preview__goal">
                    {shot.taskStatement || shot.scene || shot.subject || "（方案描述生成中）"}
                  </div>
                  <div className="studio-plan-preview__bullets">
                    {shot.subject && (
                      <div className="studio-plan-preview__bullet">主体：{shot.subject}</div>
                    )}
                    {shot.scene && <div className="studio-plan-preview__bullet">场景：{shot.scene}</div>}
                    {(shot.answersQuestions || []).slice(0, 3).map((q, i) => (
                      <div key={i} className="studio-plan-preview__bullet">
                        回答买家：{q}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {shot.finalPrompt && (
                <div className="isa-plan-card__prompt">
                  <button type="button" className="isa-link-btn" onClick={() => onToggleExpand(shot.order)}>
                    {expanded ? "收起完整 prompt ▲" : "查看完整 prompt ▼"}
                  </button>
                  {expanded && <div className="isa-plan-card__prompt-text">{shot.finalPrompt}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ============================ 上传卡片 ============================ */

function UploadCard({
  title,
  hint,
  badge,
  variant,
  files,
  onChange,
  disabled,
}: {
  title: string;
  hint: string;
  badge: string;
  variant: "primary" | "optional";
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // 为已选文件生成预览 URL（object URL），文件变化或组件卸载时释放，避免内存泄漏
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  return (
    <div
      className={`isa-upload${variant === "primary" ? " isa-upload--primary" : ""}${dragOver ? " is-dragover" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        const list = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith("image/"));
        if (list.length) onChange([...files, ...list]);
      }}
    >
      <div className="isa-upload__head">
        <span className="isa-upload__title">{title}</span>
        <span className={`isa-upload__badge isa-upload__badge--${variant === "primary" ? "req" : "opt"}`}>
          {badge}
        </span>
      </div>
      <div className="isa-upload__hint">
        {hint}
        <span className="isa-upload__hint-drag"> 也可直接把图片拖到这里</span>
      </div>
      <div className="isa-upload__row">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="isa-btn"
        >
          选择图片
        </button>
        <span className="isa-upload__count">已选 {files.length} 张</span>
        {files.length > 0 && !disabled && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="isa-btn isa-btn--ghost-danger"
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
        <div className="isa-thumbs">
          {files.map((f, i) => (
            <div key={i} className="isa-thumb" title={f.name}>
              <div className="isa-thumb__frame">
                {previews[i] && <img className="isa-thumb__img" src={previews[i]} alt="" />}
                {!disabled && (
                  <button
                    type="button"
                    className="isa-thumb__del"
                    onClick={() => onChange(files.filter((_, idx) => idx !== i))}
                    aria-label={`移除 ${f.name}`}
                  >
                    ×
                  </button>
                )}
              </div>
              <span className="isa-thumb__name">{f.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
