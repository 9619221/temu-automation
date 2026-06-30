import { useState, useRef, useEffect, useCallback, type RefObject } from "react";
import { message } from "antd";
import { SendOutlined, CloseOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { useAgentSSE, toolZh as sseToolZh, type AgentEvent } from "../hooks/useAgentSSE";

function useDraggable(
  elRef: RefObject<HTMLElement | null>,
  handleRef?: RefObject<HTMLElement | null>,
) {
  const moved = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const el = elRef.current;
    const handle = handleRef?.current ?? el;
    if (!el || !handle) return;
    let ox = 0, oy = 0, dragging = false;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("button") || t.closest("textarea") || t.closest(".ab-home__action")) return;
      const r = el.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      dragging = true; moved.current = false;
      el.style.transition = "none";
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      moved.current = true;
      let x = e.clientX - ox, y = e.clientY - oy;
      x = Math.max(0, Math.min(x, innerWidth - el.offsetWidth));
      y = Math.max(0, Math.min(y, innerHeight - el.offsetHeight));
      el.style.left = x + "px"; el.style.top = y + "px";
      el.style.right = "auto"; el.style.bottom = "auto";
    };
    const onUp = () => { if (dragging) { el.style.transition = ""; dragging = false; } };
    handle.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      handle.removeEventListener("mousedown", onDown);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [elRef, handleRef, tick]);
  const rebind = useCallback(() => setTick(t => t + 1), []);
  return { moved, rebind };
}
import {
  useAgentStatus, usePendingApprovals, useAgentActions,
  type ApprovalItem,
} from "../hooks/useAgentDashboard";
import "../styles/agentBot.css";

type Mood = "idle" | "running" | "alert" | "offline";
type View = "home" | "chat";

const CHAR_IMG = "data:image/png;base64,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";

const TOOL_ZH: Record<string, string> = {
  "erp.purchase.confirm_order": "确认采购单",
  "erp.pricing.adjust_price": "调整价格",
  "erp.image.publish_to_live": "主图上线",
  "erp.review.reply": "回复评论",
  "erp.outbound.get_pending": "查待发货",
  "erp.purchase.create_draft": "创建采购草稿",
  "erp.outbound.process_normal": "常规发货",
};
function toolZh(n: string) { return TOOL_ZH[n] || sseToolZh(n); }

interface Msg {
  id: string;
  role: "user" | "agent" | "system" | "step";
  text: string;
  ts: number;
}

function AgentMd({ text }: { text: string }) {
  const html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^(\d+)\.\s/gm, "<span class='ab-md-num'>$1.</span> ")
    .replace(/^[-•]\s/gm, "<span class='ab-md-bullet'></span>")
    .replace(/\n/g, "<br/>");
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

const QUICK_ACTIONS = [
  { icon: "\u{1F6E1}", title: "启动巡逻", desc: "全面体检", action: "patrol" },
  { icon: "\u{1F4E6}", title: "库存预警", desc: "低库存/超卖", action: "ask", q: "哪些SKU快断货了?" },
  { icon: "\u{2B50}", title: "差评监控", desc: "近期差评", action: "ask", q: "最近差评情况怎样?" },
  { icon: "\u{1F4CB}", title: "待处理", desc: "今日事项", action: "ask", q: "今天有什么待处理的?" },
] as const;

export default function AgentFloatingBot() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("home");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [eggN, setEggN] = useState(0);
  const [wiggle, setWiggle] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fabRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hdRef = useRef<HTMLDivElement>(null);
  const { moved: fabMoved, rebind: fabRebind } = useDraggable(fabRef);
  useDraggable(panelRef, hdRef);

  const { status } = useAgentStatus();
  const { items: approvals, reload: reloadApprovals } = usePendingApprovals();
  const { startPatrol, sendMessage, abort, approveItem, rejectItem } = useAgentActions();

  const mood: Mood =
    !status.initialized ? "offline" :
    approvals.length > 0 ? "alert" :
    status.running ? "running" : "idle";

  const streamRef = useRef<string | null>(null);
  const replyShownRef = useRef(false);

  useEffect(() => { if (!open) fabRebind(); }, [open, fabRebind]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open]);
  useEffect(() => { if (open && view === "chat") setTimeout(() => taRef.current?.focus(), 80); }, [open, view]);

  const push = useCallback((role: Msg["role"], text: string) => {
    setMsgs(p => [...p, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role, text, ts: Date.now() }]);
  }, []);

  const busyTimer = useRef<ReturnType<typeof setTimeout>>();
  const markBusy = useCallback(() => {
    setBusy(true);
    clearTimeout(busyTimer.current);
    busyTimer.current = setTimeout(() => {
      setBusy(false);
      push("system", "响应超时，请重试");
    }, 120_000);
  }, [push]);
  const markIdle = useCallback(() => {
    setBusy(false);
    clearTimeout(busyTimer.current);
  }, []);

  const onSSE = useCallback((evt: AgentEvent) => {
    switch (evt.type) {
      case "turn:start":
        if (streamRef.current) {
          const oldId = streamRef.current;
          setMsgs(p => p.map(m => m.id === oldId ? { ...m, role: "step" as Msg["role"] } : m));
          streamRef.current = null;
        }
        break;
      case "thinking": {
        replyShownRef.current = true;
        markBusy();
        if (!streamRef.current) {
          const id = `stream_${Date.now()}`;
          streamRef.current = id;
          setMsgs(p => [...p, { id, role: "agent", text: evt.text, ts: Date.now() }]);
        } else {
          const sid = streamRef.current;
          setMsgs(p => p.map(m => m.id === sid ? { ...m, text: m.text + evt.text } : m));
        }
        break;
      }
      case "tool:start":
        push("step", `${sseToolZh(evt.tool)}...`);
        markBusy();
        break;
      case "tool:done":
        markBusy();
        break;
      case "tool:error":
        push("step", `${sseToolZh(evt.tool)} 失败`);
        markBusy();
        break;
      case "tool:pending_approval":
        push("step", `${sseToolZh(evt.tool)} 等待审批`);
        reloadApprovals();
        markBusy();
        break;
      case "reply":
        break;
      case "run:complete":
        streamRef.current = null;
        markIdle();
        break;
      case "run:error":
        streamRef.current = null;
        push("system", `执行出错: ${evt.error}`);
        markIdle();
        break;
      case "run:aborted":
        streamRef.current = null;
        push("system", "已终止");
        markIdle();
        break;
    }
  }, [push, reloadApprovals, markIdle, markBusy]);

  useAgentSSE(onSSE);

  const egg = useCallback(() => {
    const n = eggN + 1;
    if (n >= 7) {
      setWiggle(true); setEggN(0);
      setTimeout(() => setWiggle(false), 700);
    } else {
      setEggN(n);
      setTimeout(() => setEggN(0), 2000);
    }
  }, [eggN]);

  const send = async () => {
    const t = input.trim(); if (!t || busy) return;
    push("user", t); setInput(""); markBusy();
    streamRef.current = null;
    replyShownRef.current = false;
    setView("chat");
    try {
      const result = await sendMessage(t);
      if (result?.reply && !replyShownRef.current) {
        push("agent", result.reply);
      }
      markIdle();
    } catch (e: any) {
      push("system", `失败: ${e?.message || "未知"}`);
      markIdle();
    }
  };

  const patrol = async () => {
    setView("chat"); markBusy();
    push("system", "巡逻启动中...");
    streamRef.current = null;
    replyShownRef.current = false;
    try {
      const result = await startPatrol();
      if (result?.reply && !replyShownRef.current) {
        push("agent", result.reply);
      }
      markIdle();
    } catch (e: any) {
      push("system", `失败: ${e?.message || "未知"}`);
      markIdle();
    }
  };

  const doAbort = async () => {
    try { await abort(); }
    catch (e: any) { message.error(e?.message || "失败"); }
  };

  const doApprove = async (item: ApprovalItem) => {
    try { await approveItem(item.id); push("system", `已通过 ${toolZh(item.tool_name)}`); reloadApprovals(); }
    catch (e: any) { message.error(e?.message || "失败"); }
  };

  const doReject = async (item: ApprovalItem) => {
    try { await rejectItem(item.id); push("system", `已拒绝 ${toolZh(item.tool_name)}`); reloadApprovals(); }
    catch (e: any) { message.error(e?.message || "失败"); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const quickAction = (a: typeof QUICK_ACTIONS[number]) => {
    if (a.action === "patrol") {
      patrol();
    } else {
      setInput(a.q);
      setView("chat");
      setTimeout(() => taRef.current?.focus(), 80);
    }
  };

  const backHome = () => {
    setView("home");
  };

  /* ─── FAB ─── */
  if (!open) {
    return (
      <div ref={fabRef} className={`ab-fab ab-fab--${mood}`} onClick={() => { if (!fabMoved.current) setOpen(true); }}>
        <div className="ab-fab__char">
          <img src={CHAR_IMG} alt="Lumis" draggable={false} />
        </div>
        <div className="ab-fab__badge" />
        <div className="ab-fab__sparkles">
          <span className="ab-fab__sparkle" />
          <span className="ab-fab__sparkle" />
          <span className="ab-fab__sparkle" />
        </div>
        <div className="ab-fab__zzz"><span>z</span><span>z</span><span>z</span></div>
      </div>
    );
  }

  /* ─── Panel ─── */
  const dotClass = mood === "running" ? "blue" : mood === "alert" ? "orange" : mood === "offline" ? "gray" : "green";
  const statusText = status.running ? "正在巡逻..." : status.initialized ? "在线" : "离线";

  return (
    <div ref={panelRef} className="ab-panel">
      {/* Header */}
      <div ref={hdRef} className="ab-hd">
        <div className="ab-hd__left" onClick={egg}>
          <div className={`ab-hd__avatar ${wiggle ? "ab-wiggle" : ""}`}>
            <img src={CHAR_IMG} alt="Lumis" draggable={false} />
          </div>
          <div className="ab-hd__info">
            <div className="ab-hd__name">鲁米斯 Lumis</div>
            <div className="ab-hd__status">
              <span className={`ab-hd__dot ab-hd__dot--${dotClass}`} />
              {statusText}
            </div>
          </div>
        </div>
        <button className="ab-hd__close" onClick={() => setOpen(false)}>
          <CloseOutlined />
        </button>
      </div>

      {/* Approvals */}
      {approvals.length > 0 && (
        <div className="ab-approvals">
          <div className="ab-approvals__title">需要你的确认</div>
          {approvals.slice(0, 3).map(item => (
            <div key={item.id} className="ab-approval-card">
              <span className="ab-approval-card__name">{toolZh(item.tool_name)}</span>
              <div className="ab-approval-card__actions">
                <button className="ab-approval-card__btn ab-approval-card__btn--yes" onClick={() => doApprove(item)}>允许</button>
                <button className="ab-approval-card__btn ab-approval-card__btn--no" onClick={() => doReject(item)}>拒绝</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="ab-body">
        {view === "home" ? (
          /* ── Home / Actions View ── */
          <div className="ab-home">
            <div className="ab-home__hero">
              <img className="ab-home__hero-img" src={CHAR_IMG} alt="" draggable={false} />
              <div className="ab-home__greeting">有什么可以帮你?</div>
              <div className="ab-home__sub">我是鲁米斯，你的 ERP 智能助手</div>
            </div>
            <div className="ab-home__grid">
              {QUICK_ACTIONS.map((a, i) => (
                <div key={i} className="ab-home__action" onClick={() => quickAction(a)}>
                  <div className="ab-home__action-icon">{a.icon}</div>
                  <div className="ab-home__action-text">
                    <div className="ab-home__action-title">{a.title}</div>
                    <div className="ab-home__action-desc">{a.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="ab-home__hint">输入任何问题，或点击上方快捷操作</div>
          </div>
        ) : (
          /* ── Chat View ── */
          <div className="ab-msgs">
            <button className="ab-msgs__back" onClick={backHome}>
              <ArrowLeftOutlined /> 返回
            </button>
            {msgs.map(m => (
              <div key={m.id} className={`ab-msg ab-msg--${m.role}`}>
                {m.role === "agent" && (
                  <div className="ab-msg__av">
                    <img src={CHAR_IMG} alt="" draggable={false} />
                  </div>
                )}
                {m.role === "system" ? (
                  <div className="ab-bbl ab-bbl--system">{m.text}</div>
                ) : m.role === "step" ? (
                  <div className="ab-bbl ab-bbl--step">{m.text}</div>
                ) : m.role === "agent" ? (
                  <div className="ab-bbl ab-bbl--agent"><AgentMd text={m.text} /></div>
                ) : (
                  <div className={`ab-bbl ab-bbl--${m.role}`}>{m.text}</div>
                )}
                {m.role === "user" && (
                  <div className="ab-msg__av">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
            {busy && !streamRef.current && (
              <div className="ab-typing">
                <div className="ab-msg__av">
                  <img src={CHAR_IMG} alt="" draggable={false} />
                </div>
                <div className="ab-typing__dots">
                  <span className="ab-typing__dot" />
                  <span className="ab-typing__dot" />
                  <span className="ab-typing__dot" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="ab-ft">
        <div className="ab-ft__actions">
          {status.running ? (
            <>
              <button className="ab-ft__btn ab-ft__btn--stop" onClick={doAbort}>终止</button>
              <span className="ab-ft__run-tag"><span className="ab-ft__run-dot" />巡逻中</span>
            </>
          ) : (
            <button className="ab-ft__btn ab-ft__btn--patrol" onClick={patrol} disabled={!status.initialized}>
              启动巡逻
            </button>
          )}
        </div>
        <div className="ab-ft__input">
          <textarea
            ref={taRef}
            className="ab-ft__textarea"
            rows={1}
            placeholder="跟鲁米斯说点什么..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            disabled={!status.initialized || status.running}
          />
          <button
            className="ab-ft__send"
            onClick={send}
            disabled={!status.initialized || status.running || !input.trim()}
          >
            <SendOutlined />
          </button>
        </div>
      </div>
    </div>
  );
}
